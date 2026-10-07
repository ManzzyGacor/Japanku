import fs from 'fs';
import os from 'os';
import path from 'path';
import { fork } from 'child_process';
import QRCode from 'qrcode';
import { db } from './db.js';
import { env, ROOT } from './env.js';
import { sumberDayaServer } from './tiers.js';

/*
 Manajer bot: satu server = satu proses anak (bot/worker.js) = satu nomor WhatsApp.

 - Data tiap server terpisah di storage/servers/<id>/ (sesi, whitelist, autojpm, gambar).
 - Status, kode pairing, QR, dan log dikirim bot lewat IPC lalu disimpan di memori
   untuk ditampilkan di dashboard.
 - Aturan "1 nomor hanya untuk 1 server" dijaga dua lapis: dicek sebelum pairing,
   dan kolom servers.phone di database bersifat UNIQUE.
*/

const WORKER = path.join(ROOT, 'bot', 'worker.js');
const DIR_SERVER = path.join(env.storageDir, 'servers');
const MAKS_LOG = 400;
const BATAS_MATI_MS = 8000; // tunggu bot menutup diri sebelum dipaksa berhenti
const JEDA_RESTART = [5000, 15000, 30000, 60000, 120000];
const JENDELA_RESTART_MS = 10 * 60 * 1000;

const KELUAR_LOGOUT = 3;

/** Pengaturan bot bawaan untuk server baru. Bisa diubah pemilik dari dashboard. */
export const PENGATURAN_BOT_AWAL = {
  namaBot: 'VaresaJasher',
  prefix: ['.', '#'],
  jedaKirim: 15,
  autojpm: { tagSemua: false, jedaPutaran: 1400 },
  mode: 'production',
  nomorOwner: [],
};

// Variabel lingkungan yang diteruskan ke bot. Rahasia web lain tidak ikut.
const ENV_DITERUSKAN = [
  'PATH', 'HOME', 'TZ', 'LANG', 'LC_ALL', 'TMPDIR', 'TEMP', 'TMP', 'SystemRoot', 'NODE_ENV', 'DEBUG',
  'HTTP_PROXY', 'HTTPS_PROXY', 'NO_PROXY', 'http_proxy', 'https_proxy', 'no_proxy', 'NODE_EXTRA_CA_CERTS',
];

const hapusAnsi = (teks) => String(teks).replace(/\x1b\[[0-9;]*m/g, '');
export const nomorDariJid = (jid) => String(jid ?? '').split(/[:@]/)[0].replace(/\D/g, '');

export function folderServer(serverId) {
  return path.join(DIR_SERVER, String(Number(serverId)));
}

export function bacaPengaturanBot(server) {
  let tersimpan = {};
  try {
    tersimpan = JSON.parse(server.settings || '{}');
  } catch {
    tersimpan = {};
  }
  return {
    ...PENGATURAN_BOT_AWAL,
    ...tersimpan,
    autojpm: { ...PENGATURAN_BOT_AWAL.autojpm, ...(tersimpan.autojpm ?? {}) },
  };
}

class BotManager {
  constructor() {
    /** @type {Map<number, object>} */
    this.bot = new Map();
  }

  /** Data runtime satu server (dibuat kalau belum ada) */
  rt(serverId) {
    const id = Number(serverId);
    if (!this.bot.has(id)) {
      this.bot.set(id, {
        id,
        status: 'offline',
        message: '',
        pairingCode: null,
        qrDataUrl: null,
        method: null,
        pendingPhone: null,
        jid: null,
        child: null,
        startedAt: null,
        stopRequested: false,
        restarts: [],
        restartTimer: null,
        pairingTimer: null,
        logs: [],
        nextLogId: 1,
      });
    }
    return this.bot.get(id);
  }

  // -------------------------------------------------------------------------
  // Baca status
  // -------------------------------------------------------------------------

  isRunning(serverId) {
    return Boolean(this.bot.get(Number(serverId))?.child);
  }

  snapshot(serverId) {
    const rt = this.bot.get(Number(serverId));
    if (!rt) return { status: 'offline', message: '', pairingCode: null, qrDataUrl: null, method: null, pendingPhone: null, startedAt: null };
    return {
      status: rt.status,
      message: rt.message,
      pairingCode: rt.pairingCode,
      qrDataUrl: rt.qrDataUrl,
      method: rt.method,
      pendingPhone: rt.pendingPhone,
      startedAt: rt.startedAt,
    };
  }

  logs(serverId, afterId = 0) {
    const rt = this.bot.get(Number(serverId));
    if (!rt) return [];
    return rt.logs.filter((l) => l.id > afterId);
  }

  /** Nomor ini sedang dipakai untuk pairing di server lain? */
  sedangDipairing(phone, kecualiServerId) {
    for (const rt of this.bot.values()) {
      if (rt.id !== Number(kecualiServerId) && rt.child && rt.pendingPhone === phone) return true;
    }
    return false;
  }

  /** Jumlah bot yang sedang berjalan (untuk panel admin) */
  jumlahBerjalan() {
    let n = 0;
    for (const rt of this.bot.values()) if (rt.child) n += 1;
    return n;
  }

  // -------------------------------------------------------------------------
  // Log
  // -------------------------------------------------------------------------

  catat(serverId, text, level = 'green') {
    const rt = this.rt(serverId);
    for (const baris of hapusAnsi(text).split('\n')) {
      if (!baris.trim()) continue;
      rt.logs.push({ id: rt.nextLogId++, ts: Date.now(), level, text: baris.slice(0, 1000) });
    }
    if (rt.logs.length > MAKS_LOG) rt.logs.splice(0, rt.logs.length - MAKS_LOG);
  }

  // -------------------------------------------------------------------------
  // Menyalakan & mematikan
  // -------------------------------------------------------------------------

  /**
   * Nyalakan bot untuk server ini.
   * @param {object} server baris dari tabel servers
   * @param {object} [opsi]
   * @param {{metode: 'pairing'|'qr', nomor?: string}} [opsi.login] cara login kalau belum ada sesi
   */
  start(server, { login = null } = {}) {
    const rt = this.rt(server.id);
    if (rt.child) throw Object.assign(new Error('Bot sudah berjalan.'), { status: 409 });

    clearTimeout(rt.restartTimer);
    rt.restartTimer = null;

    const dir = folderServer(server.id);
    fs.mkdirSync(dir, { recursive: true });

    const pengaturan = bacaPengaturanBot(server);
    const configBot = {
      ...pengaturan,
      versi: '1.0',
      github: env.github,
      login: login ?? { metode: '', nomor: '' },
    };

    const lingkungan = {};
    for (const kunci of ENV_DITERUSKAN) if (process.env[kunci] !== undefined) lingkungan[kunci] = process.env[kunci];
    Object.assign(lingkungan, {
      VJ_BOT_CONFIG: JSON.stringify(configBot),
      VJ_SERVER_ID: String(server.id),
      BOT_SIMULASI: env.botSimulasi ? '1' : '0',
      FORCE_COLOR: '0',
    });

    rt.stopRequested = false;
    rt.status = 'starting';
    rt.message = '';
    rt.pairingCode = null;
    rt.qrDataUrl = null;
    rt.jid = null;
    rt.method = login?.metode ?? null;
    rt.pendingPhone = login?.metode === 'pairing' ? login.nomor : null;
    rt.startedAt = Date.now();

    this.catat(server.id, login ? `Menyalakan bot untuk login (${login.metode}) ...` : 'Menyalakan bot ...', 'yellow');

    // Batas sumber daya per tier (memori heap + prioritas CPU).
    const batas = sumberDayaServer(server);
    const child = fork(WORKER, [], {
      cwd: dir,
      env: lingkungan,
      execArgv: [`--max-old-space-size=${batas.maxMemoryMb}`],
      stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
    });
    rt.child = child;

    // Prioritas CPU: tier murah dapat nice lebih tinggi (prioritas lebih
    // rendah) supaya bot paket mahal lebih didahulukan saat CPU rebutan.
    // Menurunkan prioritas tidak butuh root; kegagalan diabaikan.
    if (batas.nice > 0) {
      try {
        os.setPriority(child.pid, batas.nice);
      } catch {
        /* sebagian lingkungan menolak setPriority; abaikan */
      }
    }

    child.stderr?.on('data', (data) => this.catat(server.id, data.toString(), 'red'));
    child.on('message', (pesan) => this.terimaPesan(server.id, pesan));
    child.on('error', (error) => this.catat(server.id, `Proses bot error: ${error.message}`, 'red'));
    child.on('exit', (code, signal) => this.saatKeluar(server.id, child, code, signal));

    if (login) {
      clearTimeout(rt.pairingTimer);
      rt.pairingTimer = setTimeout(() => this.pairingHabis(server.id), env.pairingTimeoutMs);
    }
  }

  /** Matikan bot. Menunggu sampai prosesnya benar-benar berhenti. */
  stop(serverId, { pesan = '' } = {}) {
    const rt = this.rt(serverId);
    clearTimeout(rt.restartTimer);
    rt.restartTimer = null;
    clearTimeout(rt.pairingTimer);
    rt.pairingTimer = null;

    const child = rt.child;
    if (!child) {
      rt.status = 'offline';
      if (pesan) rt.message = pesan;
      return Promise.resolve();
    }

    rt.stopRequested = true;
    rt.status = 'stopping';
    if (pesan) rt.message = pesan;

    return new Promise((resolve) => {
      const paksa = setTimeout(() => child.kill('SIGKILL'), BATAS_MATI_MS);
      child.once('exit', () => {
        clearTimeout(paksa);
        resolve();
      });
      if (child.connected) child.send({ t: 'stop' });
      else child.kill('SIGTERM');
    });
  }

  async restart(server) {
    await this.stop(server.id);
    this.start(server);
  }

  /**
   * Putuskan nomor dari server: logout dari WhatsApp (kalau bot sedang jalan),
   * hapus sesi, lalu lepaskan nomor supaya server bisa dipakai nomor lain.
   */
  async logout(server) {
    const rt = this.rt(server.id);
    const child = rt.child;

    if (child && rt.status === 'online') {
      rt.stopRequested = true;
      rt.status = 'stopping';
      await new Promise((resolve) => {
        const paksa = setTimeout(() => child.kill('SIGKILL'), BATAS_MATI_MS + 4000);
        child.once('exit', () => {
          clearTimeout(paksa);
          resolve();
        });
        child.send({ t: 'logout' });
      });
    } else {
      await this.stop(server.id);
    }

    this.hapusSesi(server.id);
    db.prepare('UPDATE servers SET phone = NULL, enabled = 0 WHERE id = ?').run(server.id);
    rt.status = 'offline';
    rt.jid = null;
    rt.message = 'Nomor sudah dilepas dari server ini.';
    this.catat(server.id, 'Nomor dilepas. Server siap dihubungkan ke nomor lain.', 'yellow');
  }

  hapusSesi(serverId) {
    fs.rmSync(path.join(folderServer(serverId), 'sessions'), { recursive: true, force: true });
  }

  /** Hapus semua data server di disk (dipakai saat server dihapus) */
  hapusFolder(serverId) {
    fs.rmSync(folderServer(serverId), { recursive: true, force: true });
    this.bot.delete(Number(serverId));
  }

  // -------------------------------------------------------------------------
  // Kejadian dari proses bot
  // -------------------------------------------------------------------------

  terimaPesan(serverId, pesan) {
    const rt = this.rt(serverId);
    switch (pesan?.t) {
      case 'log':
        this.catat(serverId, pesan.text, pesan.level);
        break;

      case 'status':
        if (pesan.status === 'online') this.saatOnline(serverId, pesan.jid);
        else if (!rt.stopRequested) rt.status = pesan.status;
        break;

      case 'pairing':
        rt.status = 'pairing';
        rt.pairingCode = pesan.code;
        rt.message = '';
        break;

      case 'pairing_error':
        this.catat(serverId, 'Pairing dibatalkan karena kode tidak bisa dibuat.', 'red');
        void this.stop(serverId, {
          pesan: `Gagal meminta kode pairing (${pesan.message}). Pastikan nomor benar & terdaftar di WhatsApp.`,
        });
        break;

      case 'qr':
        rt.status = 'qr';
        QRCode.toDataURL(pesan.qr, { margin: 1, width: 280 })
          .then((url) => {
            if (rt.child) rt.qrDataUrl = url;
          })
          .catch((error) => this.catat(serverId, `Gagal membuat gambar QR: ${error.message}`, 'red'));
        break;

      case 'paired':
        this.saatTerpasang(serverId, pesan.jid);
        break;

      case 'logged_out':
        rt.message =
          pesan.reason === 'no_session'
            ? 'Belum ada nomor yang terhubung. Hubungkan nomor terlebih dahulu.'
            : 'Sesi WhatsApp terputus (logout dari HP / perangkat dikeluarkan). Hubungkan ulang nomor kamu.';
        break;

      default:
        break;
    }
  }

  /**
   * Pairing / scan QR berhasil. Ikat nomor ke server ini, kecuali nomor itu
   * sudah terikat ke server lain (aturan 1 nomor = 1 server).
   */
  saatTerpasang(serverId, jid) {
    const rt = this.rt(serverId);
    const phone = nomorDariJid(jid);
    if (!phone) return;

    const lain = db.prepare('SELECT id FROM servers WHERE phone = ? AND id != ?').get(phone, serverId);
    if (lain) {
      this.catat(serverId, `Nomor ${phone} sudah terhubung di server lain. Login dibatalkan.`, 'red');
      rt.message = `Nomor ${phone} sudah dipakai di server lain. 1 nomor hanya untuk 1 server.`;
      rt.stopRequested = true;
      rt.status = 'stopping';
      rt.child?.send({ t: 'logout' });
      return;
    }

    try {
      db.prepare('UPDATE servers SET phone = ?, enabled = 1 WHERE id = ?').run(phone, serverId);
    } catch (error) {
      // UNIQUE constraint: balapan dengan server lain di detik yang sama
      this.catat(serverId, `Gagal mengikat nomor: ${error.message}`, 'red');
      rt.message = `Nomor ${phone} sudah dipakai di server lain.`;
      rt.stopRequested = true;
      rt.child?.send({ t: 'logout' });
      return;
    }

    clearTimeout(rt.pairingTimer);
    rt.pairingTimer = null;
    rt.jid = jid;
    rt.pairingCode = null;
    rt.qrDataUrl = null;
    rt.pendingPhone = null;
    rt.message = '';
  }

  saatOnline(serverId, jid) {
    const rt = this.rt(serverId);
    if (rt.stopRequested) return;

    if (jid) {
      const server = db.prepare('SELECT phone FROM servers WHERE id = ?').get(serverId);
      if (!server?.phone) this.saatTerpasang(serverId, jid);
      if (rt.stopRequested) return;
    }

    clearTimeout(rt.pairingTimer);
    rt.pairingTimer = null;
    rt.status = 'online';
    rt.message = '';
    rt.pairingCode = null;
    rt.qrDataUrl = null;
    rt.pendingPhone = null;
    rt.method = null;
    if (jid) rt.jid = jid;
    db.prepare('UPDATE servers SET last_online_at = ? WHERE id = ?').run(Date.now(), serverId);
  }

  pairingHabis(serverId) {
    const rt = this.rt(serverId);
    rt.pairingTimer = null;
    if (!rt.child || rt.status === 'online') return;

    this.catat(serverId, 'Waktu pairing habis.', 'red');
    this.stop(serverId, { pesan: 'Waktu pairing habis. Tekan Hubungkan untuk mencoba lagi.' }).then(() => {
      const server = db.prepare('SELECT phone FROM servers WHERE id = ?').get(serverId);
      if (!server?.phone) this.hapusSesi(serverId);
    });
  }

  saatKeluar(serverId, child, code, signal) {
    const rt = this.rt(serverId);
    if (rt.child !== child) return; // proses lama yang sudah diganti

    const sedangLogin = Boolean(rt.method) && rt.status !== 'online';
    rt.child = null;
    rt.pairingCode = null;
    rt.qrDataUrl = null;
    rt.pendingPhone = null;
    rt.method = null;
    clearTimeout(rt.pairingTimer);
    rt.pairingTimer = null;

    this.catat(serverId, `Bot berhenti (kode ${code ?? signal}).`, code === 0 ? 'yellow' : 'red');

    const server = db.prepare('SELECT * FROM servers WHERE id = ?').get(serverId);
    if (!server) return;

    // Sesi tidak berlaku lagi -> lepaskan nomor, pemilik harus menghubungkan ulang
    if (code === KELUAR_LOGOUT) {
      this.hapusSesi(serverId);
      db.prepare('UPDATE servers SET phone = NULL, enabled = 0 WHERE id = ?').run(serverId);
      rt.status = 'offline';
      rt.jid = null;
      if (!rt.message) rt.message = 'Sesi WhatsApp terputus. Hubungkan ulang nomor kamu.';
      return;
    }

    if (rt.stopRequested) {
      if (!server.phone) this.hapusSesi(serverId); // pairing yang dibatalkan: buang sesi setengah jadi
      rt.status = 'offline';
      return;
    }

    // Gagal saat proses login -> jangan diulang otomatis
    if (sedangLogin || !server.phone) {
      if (!server.phone) this.hapusSesi(serverId);
      rt.status = 'offline';
      if (!rt.message) rt.message = 'Login gagal. Coba hubungkan lagi.';
      return;
    }

    // Mati tak terduga -> nyalakan ulang dengan jeda yang makin lama
    if (server.enabled && server.expires_at > Date.now()) {
      const sekarang = Date.now();
      rt.restarts = rt.restarts.filter((t) => sekarang - t < JENDELA_RESTART_MS);

      if (rt.restarts.length >= JEDA_RESTART.length) {
        rt.status = 'error';
        rt.message = 'Bot berkali-kali mati. Cek terminal lalu nyalakan ulang manual.';
        this.catat(serverId, 'Terlalu sering mati, tidak dinyalakan ulang otomatis.', 'red');
        return;
      }

      const jeda = JEDA_RESTART[rt.restarts.length];
      rt.restarts.push(sekarang);
      rt.status = 'reconnecting';
      rt.message = `Bot mati tak terduga, menyala ulang dalam ${jeda / 1000} detik ...`;
      this.catat(serverId, rt.message, 'yellow');

      rt.restartTimer = setTimeout(() => {
        rt.restartTimer = null;
        const terbaru = db.prepare('SELECT * FROM servers WHERE id = ?').get(serverId);
        if (terbaru?.enabled && terbaru.phone && terbaru.expires_at > Date.now() && !rt.child) this.start(terbaru);
      }, jeda);
      return;
    }

    rt.status = 'offline';
  }

  // -------------------------------------------------------------------------
  // Seluruh server
  // -------------------------------------------------------------------------

  /** Nyalakan lagi semua bot yang aktif setelah server web restart (bergantian, tidak sekaligus) */
  resumeAll() {
    const daftar = db
      .prepare('SELECT * FROM servers WHERE enabled = 1 AND phone IS NOT NULL AND expires_at > ? ORDER BY id')
      .all(Date.now());

    daftar.forEach((server, i) => {
      setTimeout(() => {
        const terbaru = db.prepare('SELECT * FROM servers WHERE id = ?').get(server.id);
        if (terbaru?.enabled && terbaru.phone && !this.isRunning(server.id)) {
          try {
            this.start(terbaru);
          } catch (error) {
            this.catat(server.id, `Gagal menyalakan: ${error.message}`, 'red');
          }
        }
      }, i * 2000);
    });

    return daftar.length;
  }

  /** Matikan server yang masa aktifnya habis */
  async cekKedaluwarsa() {
    const habis = db
      .prepare('SELECT id FROM servers WHERE expires_at <= ? AND enabled = 1')
      .all(Date.now());

    for (const { id } of habis) {
      db.prepare('UPDATE servers SET enabled = 0 WHERE id = ?').run(id);
      this.catat(id, 'Masa aktif server habis. Bot dimatikan. Perpanjang untuk menyalakan lagi.', 'red');
      await this.stop(id, { pesan: 'Masa aktif habis. Perpanjang server untuk menyalakan bot lagi.' });
    }
  }

  async stopAll() {
    await Promise.all([...this.bot.keys()].map((id) => this.stop(id)));
  }
}

export const manager = new BotManager();

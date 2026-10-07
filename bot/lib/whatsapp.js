import fs from 'fs';
import path from 'path';
import { WaClient, createStore, createNoopLogger, createPinoLogger } from 'zapo-js';
import { createSqliteStore } from '@zapo-js/store-sqlite';
import { createMediaProcessor } from '@zapo-js/media-utils';

import config from '../config.js';
import { log } from './logger.js';
import { kirimKeWeb } from './ipc.js';
import { handleMessage, initHandler } from './handler.js';
import { koneksi } from './state.js';

// Node 20 belum punya WebSocket bawaan -> pakai paket "ws" sebagai gantinya.
if (typeof globalThis.WebSocket === 'undefined') {
  const { WebSocket } = await import('ws');
  globalThis.WebSocket = WebSocket;
}

const SESSION_PATH = path.join(process.cwd(), config.fileSesi);

// Penyebab putus koneksi yang TIDAK boleh disambung ulang otomatis
const PUTUS_PERMANEN = new Set([
  'stream_error_replaced',
  'stream_error_device_removed',
  'stream_error_force_logout',
  'failure_not_authorized',
  'failure_banned',
  'failure_locked',
  'failure_bad_user_agent',
  'primary_identity_key_change',
]);

const MAKS_PERCOBAAN = 10;

// Kode keluar proses yang dibaca oleh src/bot-manager.js
export const KELUAR = {
  NORMAL: 0, // dimatikan dengan sengaja
  ERROR: 1, // gagal / menyerah menyambung ulang -> boleh dinyalakan ulang otomatis
  LOGOUT: 3, // sesi tidak bisa dipakai lagi -> harus pairing ulang
};

/** Nomor telepon dari JID, mis. "628123:12@s.whatsapp.net" -> "628123" */
export function nomorDariJid(jid) {
  return String(jid ?? '').split(/[:@]/)[0];
}

/** Login dari pengaturan server (dashboard). Mengembalikan null kalau tidak diatur. */
function loginDariConfig() {
  const metode = String(config.login?.metode ?? '').toLowerCase().trim();

  if (metode === 'qr') return { metode };

  if (metode === 'pairing') {
    const nomor = String(config.login?.nomor ?? '').replace(/\D/g, '');
    if (nomor) return { metode, nomor };
    log('Metode pairing dipilih tapi nomor masih kosong.', 'red');
  }

  return null;
}

/** Buat penyimpanan sesi (SQLite) */
function buatStore() {
  fs.mkdirSync(path.dirname(SESSION_PATH), { recursive: true });

  return createStore({
    backends: { sqlite: createSqliteStore({ path: SESSION_PATH, driver: 'auto' }) },
    providers: {
      auth: 'sqlite',
      signal: 'sqlite',
      preKey: 'sqlite',
      session: 'sqlite',
      identity: 'sqlite',
      senderKey: 'sqlite',
      appState: 'sqlite',
      privacyToken: 'sqlite',
      messages: 'sqlite',
      threads: 'sqlite',
      contacts: 'sqlite',
    },
  });
}

/** Minta kode pairing 8 digit lalu kirim ke dashboard */
async function mintaKodePairing(client, nomor) {
  try {
    const code = await client.auth.requestPairingCode(nomor);
    const rapi = code.match(/.{1,4}/g)?.join('-') ?? code;
    log(`Kode pairing: ${rapi}`);
    log('Buka WhatsApp > Perangkat tertaut > Tautkan dengan nomor telepon, lalu masukkan kode di atas.', 'yellow');
    kirimKeWeb('pairing', { code: rapi });
  } catch (error) {
    log(`Gagal meminta kode pairing: ${error.message}`, 'red');
    kirimKeWeb('pairing_error', { message: error.message });
  }
}

/** Pasang semua event: login, pesan masuk, koneksi putus */
function pasangEvent(client, login, onReady) {
  const modePairing = login?.metode === 'pairing' && Boolean(login.nomor);
  let kodeSudahDiminta = false;

  // Kode pairing baru boleh diminta setelah server siap.
  // Tanda kesiapan itu adalah QR pertama yang dikirim server
  // (event auth_pairing_required hanya muncul saat kode PERLU diperbarui).
  client.on('auth_qr', ({ qr }) => {
    // Sesi lama dipakai tapi server minta login lagi -> sesi sudah tidak berlaku.
    if (!login) {
      log('Sesi tersimpan sudah tidak berlaku. Silakan pairing ulang dari dashboard.', 'red');
      kirimKeWeb('logged_out', { reason: 'session_invalid' });
      void client.disconnect().catch(() => {}).finally(() => process.exit(KELUAR.LOGOUT));
      return;
    }

    if (modePairing) {
      if (!kodeSudahDiminta) {
        kodeSudahDiminta = true;
        void mintaKodePairing(client, login.nomor);
      }
      return; // metode pairing: QR tidak ditampilkan
    }

    kirimKeWeb('qr', { qr });
    log('QR baru siap, scan dari dashboard.', 'yellow');
  });

  client.on('auth_pairing_required', ({ forceManual }) => {
    if (!modePairing) return;
    if (kodeSudahDiminta && !forceManual) return; // kode lama masih berlaku

    kodeSudahDiminta = true;
    log('Kode pairing kedaluwarsa, meminta kode baru ...', 'yellow');
    void mintaKodePairing(client, login.nomor);
  });

  client.on('auth_paired', ({ credentials }) => {
    log(`Berhasil terhubung sebagai ${nomorDariJid(credentials.meJid)}`);
    kirimKeWeb('paired', { jid: credentials.meJid });
  });

  client.on('message', (event) => handleMessage(client, event));

  client.on('connection', (event) => {
    if (event.status === 'open') {
      koneksi.siap = true;
      const jid = client.getCredentials()?.meJid ?? null;
      log('Connection Success');
      kirimKeWeb('status', { status: 'online', jid });
      onReady?.(client);
      return;
    }
    if (event.status === 'close') {
      koneksi.siap = false;
      log(`Connection Closed (${event.reason})`, 'red');
    }
  });
}

/** Sambung ulang otomatis dengan jeda yang makin lama */
function pasangReconnect(client) {
  let percobaan = 0;
  let sedangMenyambung = false;

  client.on('connection', async (event) => {
    if (event.status === 'open') {
      percobaan = 0;
      return;
    }
    if (event.status !== 'close') return;

    if (event.reason === 'client_disconnected') return; // kita sendiri yang menutup
    if (event.isLogout || PUTUS_PERMANEN.has(event.reason)) {
      koneksi.mati = true;
      log('SESI SUDAH TIDAK BISA DIPAKAI - perangkat dikeluarkan oleh WhatsApp.', 'red');
      log('Silakan pairing ulang dari dashboard.', 'yellow');
      kirimKeWeb('logged_out', { reason: event.reason ?? 'logout' });
      setTimeout(() => process.exit(KELUAR.LOGOUT), 500);
      return;
    }
    if (sedangMenyambung) return;

    sedangMenyambung = true;
    while (percobaan < MAKS_PERCOBAAN) {
      const jeda = Math.min(30000, 1000 * 2 ** percobaan);
      percobaan += 1;
      log(`Menyambung ulang dalam ${jeda / 1000} detik (percobaan ${percobaan})`, 'yellow');
      kirimKeWeb('status', { status: 'reconnecting', attempt: percobaan });
      await new Promise((r) => setTimeout(r, jeda));

      try {
        await client.connect();
        break;
      } catch (error) {
        log(`Gagal menyambung ulang: ${error.message}`, 'red');
      }
    }
    sedangMenyambung = false;

    if (percobaan >= MAKS_PERCOBAAN) {
      log('Menyerah menyambung ulang. Bot akan dinyalakan ulang oleh server.', 'red');
      process.exit(KELUAR.ERROR);
    }
  });
}

/** Matikan dengan rapi: tutup koneksi lalu keluar */
function pasangPenutup(client) {
  let sedangMenutup = false;

  const tutup = async (logout = false) => {
    if (sedangMenutup) return;
    sedangMenutup = true;

    if (logout) {
      log('Logout dari WhatsApp ...', 'yellow');
      await client.logout().catch((error) => log(`Logout gagal: ${error.message}`, 'red'));
      // Server WhatsApp yang menutup koneksi setelah logout; beri sedikit waktu.
      await new Promise((r) => setTimeout(r, 1500));
    }

    log('Menutup koneksi ...', 'yellow');
    await client.disconnect().catch(() => {});
    process.exit(logout ? KELUAR.LOGOUT : KELUAR.NORMAL);
  };

  process.on('SIGINT', () => tutup());
  process.on('SIGTERM', () => tutup());
  process.on('message', (pesan) => {
    if (pesan?.t === 'stop') void tutup();
    if (pesan?.t === 'logout') void tutup(true);
  });
  // Server web mati mendadak -> jangan jadi proses yatim
  process.on('disconnect', () => tutup());
}

/**
 * Nyalakan bot: siapkan sesi, ambil cara login dari pengaturan server, lalu connect.
 * @param {Function} onReady dipanggil setiap koneksi berhasil terbuka
 */
export async function startBot(onReady) {
  await initHandler();

  const store = buatStore();

  // Sesi dianggap siap pakai hanya kalau sudah punya meJid
  // (baris kredensial bisa ada tapi belum selesai login).
  const kredensial = await store
    .session('default')
    .auth.load()
    .catch(() => null);
  const sudahLogin = Boolean(kredensial?.meJid);

  let login = null;
  if (sudahLogin) {
    log(`Sesi ditemukan: ${nomorDariJid(kredensial.meJid)} - tidak perlu login ulang.`);
  } else {
    log(kredensial ? 'Login sebelumnya belum selesai.' : 'Belum ada sesi tersimpan.', 'yellow');
    login = loginDariConfig();
    if (!login) {
      log('Belum ada sesi dan cara login belum dipilih. Hubungkan nomor dari dashboard.', 'red');
      kirimKeWeb('logged_out', { reason: 'no_session' });
      process.exit(KELUAR.LOGOUT);
    }
    kirimKeWeb('status', { status: login.metode === 'qr' ? 'qr' : 'pairing' });
  }

  const logger = process.env.DEBUG ? await createPinoLogger({ level: 'info', pretty: true }) : createNoopLogger();

  const client = new WaClient(
    {
      store,
      sessionId: 'default',
      connectTimeoutMs: 15000,
      media: { processor: createMediaProcessor(), generateThumbnail: true },
    },
    logger,
  );

  pasangEvent(client, login, onReady);
  pasangReconnect(client);
  pasangPenutup(client);

  log('Connecting ...');
  kirimKeWeb('status', { status: sudahLogin ? 'connecting' : login.metode === 'qr' ? 'qr' : 'pairing' });
  await client.connect();

  return client;
}

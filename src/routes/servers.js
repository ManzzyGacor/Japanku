import { Router } from 'express';
import { db } from '../db.js';
import { wajibLogin, pembatas } from '../auth.js';
import { manager, bacaPengaturanBot } from '../bot-manager.js';
import { paketAktif, beliDariSaldo, perpanjangDariSaldo, nyalakanSetelahPerpanjang } from '../toko.js';
import { tutupInvoice } from '../pembayaran.js';
import { cekNomorTrial } from '../trial.js';
import { gagal, teks, bulat, nomorWa, rupiah } from '../util.js';

const router = Router();
router.use(wajibLogin);

/** Bentuk data server untuk browser: data database + status bot yang sedang berjalan */
export function bentukServer(server, { lengkap = false } = {}) {
  const paket = server.package_id
    ? db.prepare('SELECT id, name, days, price FROM packages WHERE id = ?').get(server.package_id)
    : null;
  const runtime = manager.snapshot(server.id);
  const kedaluwarsa = server.expires_at <= Date.now();

  const hasil = {
    id: server.id,
    name: server.name,
    phone: server.phone,
    enabled: Boolean(server.enabled),
    isTrial: Boolean(server.is_trial),
    expired: kedaluwarsa,
    expiresAt: server.expires_at,
    createdAt: server.created_at,
    lastOnlineAt: server.last_online_at,
    package: paket,
    status: kedaluwarsa && runtime.status === 'offline' ? 'expired' : runtime.status,
    message: runtime.message,
  };

  if (lengkap) {
    Object.assign(hasil, {
      pairingCode: runtime.pairingCode,
      qrDataUrl: runtime.qrDataUrl,
      method: runtime.method,
      pendingPhone: runtime.pendingPhone,
      startedAt: runtime.startedAt,
      settings: bacaPengaturanBot(server),
    });
  }
  return hasil;
}

/** Ambil server milik pengguna yang sedang login, atau 404 */
function milikku(req) {
  const server = db
    .prepare('SELECT * FROM servers WHERE id = ? AND user_id = ?')
    .get(Number(req.params.id), req.user.id);
  if (!server) gagal(404, 'Server tidak ditemukan.');
  return server;
}

const ambilServer = (id) => db.prepare('SELECT * FROM servers WHERE id = ?').get(id);

// ---------------------------------------------------------------------------
// Daftar, beli, ubah nama, hapus
// ---------------------------------------------------------------------------

router.get('/', (req, res) => {
  const daftar = db.prepare('SELECT * FROM servers WHERE user_id = ? ORDER BY id').all(req.user.id);
  res.json({ success: true, servers: daftar.map((s) => bentukServer(s)) });
});

const batasBeli = pembatas({ batas: 20, jendelaMs: 60 * 60 * 1000, kunci: (req) => `beli|${req.user?.id}` });

router.post('/', batasBeli, (req, res) => {
  const paket = paketAktif(req.body?.packageId);
  const name = teks(req.body?.name, { nama: 'Nama server', max: 40, wajib: false });

  const id = beliDariSaldo(req.user.id, { paket, name });
  res.status(201).json({ success: true, server: bentukServer(ambilServer(id)) });
});

router.get('/:id', (req, res) => {
  res.json({ success: true, server: bentukServer(milikku(req), { lengkap: true }) });
});

router.patch('/:id', (req, res) => {
  const server = milikku(req);
  const name = teks(req.body?.name, { nama: 'Nama server', max: 40 });
  db.prepare('UPDATE servers SET name = ? WHERE id = ?').run(name, server.id);
  res.json({ success: true, server: bentukServer(ambilServer(server.id), { lengkap: true }) });
});

router.delete('/:id', async (req, res) => {
  const server = milikku(req);
  if (teks(req.body?.confirm, { nama: 'Konfirmasi', max: 60 }) !== server.name) {
    gagal(400, 'Ketik nama server dengan benar untuk konfirmasi.');
  }

  if (server.phone && manager.snapshot(server.id).status === 'online') await manager.logout(server);
  else await manager.stop(server.id);

  // Batalkan tagihan perpanjang yang masih menunggu untuk server ini (best effort).
  const tagihan = db
    .prepare("SELECT * FROM invoices WHERE kind = 'renew' AND server_id = ? AND status = 'pending'")
    .all(server.id);
  for (const inv of tagihan) {
    await tutupInvoice(inv, 'cancelled').catch((e) => console.error('[server-delete] tutup invoice gagal', inv.order_id, e.message));
  }

  db.prepare('DELETE FROM servers WHERE id = ?').run(server.id);
  manager.hapusFolder(server.id);
  res.json({ success: true });
});

// ---------------------------------------------------------------------------
// Menghubungkan nomor (jadibot)
// ---------------------------------------------------------------------------

const batasHubung = pembatas({ batas: 8, jendelaMs: 10 * 60 * 1000, kunci: (req) => `hubung|${req.user?.id}` });

router.post('/:id/connect', batasHubung, async (req, res) => {
  const server = milikku(req);
  if (server.expires_at <= Date.now()) gagal(400, 'Masa aktif server habis. Perpanjang dulu.');
  if (server.phone) {
    gagal(400, `Server ini sudah terhubung ke nomor ${server.phone}. Lepas nomor dulu kalau mau ganti nomor.`);
  }

  const metode = req.body?.method === 'qr' ? 'qr' : 'pairing';
  const login = { metode };

  if (metode === 'pairing') {
    login.nomor = nomorWa(req.body?.phone);

    // 1 nomor hanya untuk 1 server
    const dipakai = db.prepare('SELECT id, user_id FROM servers WHERE phone = ?').get(login.nomor);
    if (dipakai) {
      gagal(409, dipakai.user_id === req.user.id
        ? `Nomor ${login.nomor} sudah terhubung di server kamu yang lain. 1 nomor hanya untuk 1 server.`
        : `Nomor ${login.nomor} sudah terhubung di server lain. 1 nomor hanya untuk 1 server.`);
    }
    if (manager.sedangDipairing(login.nomor, server.id)) {
      gagal(409, `Nomor ${login.nomor} sedang dalam proses pairing di server lain.`);
    }
    // Server trial: nomor harus belum pernah dipakai di situs ini (1 trial/nomor).
    if (server.is_trial) cekNomorTrial(login.nomor);
  }

  // Batalkan percobaan sebelumnya & mulai dari sesi bersih
  await manager.stop(server.id);
  manager.hapusSesi(server.id);
  manager.start(server, { login });

  res.json({ success: true, server: bentukServer(ambilServer(server.id), { lengkap: true }) });
});

/** Batalkan pairing / scan QR yang sedang berjalan */
router.post('/:id/cancel', async (req, res) => {
  const server = milikku(req);
  if (server.phone) gagal(400, 'Server sudah terhubung. Pakai tombol Matikan.');
  await manager.stop(server.id, { pesan: 'Pairing dibatalkan.' });
  manager.hapusSesi(server.id);
  res.json({ success: true, server: bentukServer(ambilServer(server.id), { lengkap: true }) });
});

/** Lepas nomor: logout dari WhatsApp, hapus sesi, server bisa dipakai nomor lain */
router.post('/:id/logout', async (req, res) => {
  const server = milikku(req);
  if (!server.phone) gagal(400, 'Server ini belum terhubung ke nomor mana pun.');
  await manager.logout(server);
  res.json({ success: true, server: bentukServer(ambilServer(server.id), { lengkap: true }) });
});

// ---------------------------------------------------------------------------
// Nyala / mati
// ---------------------------------------------------------------------------

function pastikanBisaJalan(server) {
  if (server.expires_at <= Date.now()) gagal(400, 'Masa aktif server habis. Perpanjang dulu.');
  if (!server.phone) gagal(400, 'Hubungkan nomor WhatsApp dulu.');
}

router.post('/:id/start', (req, res) => {
  const server = milikku(req);
  pastikanBisaJalan(server);
  if (manager.isRunning(server.id)) gagal(409, 'Bot sudah berjalan.');

  db.prepare('UPDATE servers SET enabled = 1 WHERE id = ?').run(server.id);
  manager.start(ambilServer(server.id));
  res.json({ success: true, server: bentukServer(ambilServer(server.id), { lengkap: true }) });
});

router.post('/:id/stop', async (req, res) => {
  const server = milikku(req);
  db.prepare('UPDATE servers SET enabled = 0 WHERE id = ?').run(server.id);
  await manager.stop(server.id, { pesan: 'Bot dimatikan.' });
  res.json({ success: true, server: bentukServer(ambilServer(server.id), { lengkap: true }) });
});

router.post('/:id/restart', async (req, res) => {
  const server = milikku(req);
  pastikanBisaJalan(server);
  db.prepare('UPDATE servers SET enabled = 1 WHERE id = ?').run(server.id);
  await manager.restart(ambilServer(server.id));
  res.json({ success: true, server: bentukServer(ambilServer(server.id), { lengkap: true }) });
});

// ---------------------------------------------------------------------------
// Pengaturan bot
// ---------------------------------------------------------------------------

function rapikanPengaturan(body) {
  const prefixMentah = Array.isArray(body?.prefix) ? body.prefix.join('') : String(body?.prefix ?? '');
  const prefix = [...new Set([...prefixMentah.replace(/\s/g, '')])];
  if (!prefix.length || prefix.length > 5 || prefix.some((p) => /[\p{L}\p{N}]/u.test(p))) {
    gagal(400, 'Prefix berisi 1-5 simbol, misalnya . # !');
  }

  const owner = (Array.isArray(body?.nomorOwner) ? body.nomorOwner : String(body?.nomorOwner ?? '').split(/[,;\n]+/))
    .map((n) => String(n).trim())
    .filter(Boolean)
    .map((n) => nomorWa(n));
  if (owner.length > 10) gagal(400, 'Maksimal 10 nomor owner tambahan.');

  return {
    namaBot: teks(body?.namaBot, { nama: 'Nama bot', max: 40 }),
    prefix,
    jedaKirim: bulat(body?.jedaKirim, { nama: 'Jeda kirim', min: 5, max: 600 }),
    autojpm: {
      tagSemua: Boolean(body?.autojpm?.tagSemua),
      jedaPutaran: bulat(body?.autojpm?.jedaPutaran, { nama: 'Jeda putaran AutoJPM', min: 60, max: 86400 }),
    },
    mode: body?.mode === 'development' ? 'development' : 'production',
    nomorOwner: [...new Set(owner)],
  };
}

router.put('/:id/settings', async (req, res) => {
  const server = milikku(req);
  const pengaturan = rapikanPengaturan(req.body);
  db.prepare('UPDATE servers SET settings = ? WHERE id = ?').run(JSON.stringify(pengaturan), server.id);

  // Bot yang sedang online dinyalakan ulang supaya pengaturan baru terpakai
  let direstart = false;
  if (manager.isRunning(server.id) && server.phone && manager.snapshot(server.id).status !== 'stopping') {
    await manager.restart(ambilServer(server.id));
    direstart = true;
  }

  res.json({
    success: true,
    message: direstart ? 'Pengaturan disimpan, bot dinyalakan ulang.' : 'Pengaturan disimpan.',
    server: bentukServer(ambilServer(server.id), { lengkap: true }),
  });
});

// ---------------------------------------------------------------------------
// Perpanjang
// ---------------------------------------------------------------------------

router.post('/:id/renew', (req, res) => {
  const server = milikku(req);
  const paket = paketAktif(req.body?.packageId);

  perpanjangDariSaldo(req.user.id, server, paket);
  nyalakanSetelahPerpanjang(server);

  res.json({
    success: true,
    message: `Server diperpanjang ${paket.days} hari (${rupiah(paket.price)}).`,
    server: bentukServer(ambilServer(server.id), { lengkap: true }),
  });
});

// ---------------------------------------------------------------------------
// Terminal
// ---------------------------------------------------------------------------

router.get('/:id/logs', (req, res) => {
  const server = milikku(req);
  const setelah = Number(req.query.after) || 0;
  res.json({ success: true, logs: manager.logs(server.id, setelah) });
});

export default router;

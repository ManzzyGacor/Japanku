import { Router } from 'express';
import { db, ubahSaldo, semuaPengaturan, simpanPengaturan } from '../db.js';
import { wajibAdmin, publicUser, isAdmin } from '../auth.js';
import { manager } from '../bot-manager.js';
import { qrisAktif, modeSimulasi, GatewayError } from '../payment.js';
import { cekDanProses, bentukInvoiceAdmin } from '../pembayaran.js';
import { env } from '../env.js';
import { bentukServer } from './servers.js';
import { gagal, teks, bulat, HARI_MS, rupiah } from '../util.js';

const router = Router();
router.use(wajibAdmin);

const cari = (q) => `%${String(q ?? '').trim()}%`;

// ---------------------------------------------------------------------------
// Ringkasan
// ---------------------------------------------------------------------------

router.get('/stats', (_req, res) => {
  const sekarang = Date.now();
  const awalBulan = new Date(new Date().getFullYear(), new Date().getMonth(), 1).getTime();
  const satu = (sql, ...p) => db.prepare(sql).get(...p);

  res.json({
    success: true,
    stats: {
      users: satu('SELECT COUNT(*) AS n FROM users').n,
      servers: satu('SELECT COUNT(*) AS n FROM servers').n,
      activeServers: satu('SELECT COUNT(*) AS n FROM servers WHERE expires_at > ?', sekarang).n,
      connectedServers: satu('SELECT COUNT(*) AS n FROM servers WHERE phone IS NOT NULL').n,
      runningBots: manager.jumlahBerjalan(),
      pendingTopups: satu("SELECT COUNT(*) AS n FROM topups WHERE status = 'pending'").n,
      topupThisMonth: satu(
        "SELECT COALESCE(SUM(amount), 0) AS n FROM topups WHERE status = 'approved' AND processed_at >= ?",
        awalBulan,
      ).n,
      salesThisMonth: -satu(
        "SELECT COALESCE(SUM(amount), 0) AS n FROM transactions WHERE type IN ('purchase', 'renew') AND created_at >= ?",
        awalBulan,
      ).n,
      pendingInvoices: satu("SELECT COUNT(*) AS n FROM invoices WHERE status = 'pending' AND expires_at > ?", sekarang).n,
      invoiceAttention: satu(
        "SELECT COUNT(*) AS n FROM invoices WHERE status != 'completed' AND handled_at IS NULL AND (recheck = 1 OR note != '')",
      ).n,
      qrisThisMonth: satu(
        "SELECT COALESCE(SUM(subtotal), 0) AS n FROM invoices WHERE status = 'completed' AND completed_at >= ?",
        awalBulan,
      ).n,
      qrisFeeThisMonth: satu(
        "SELECT COALESCE(SUM(fee), 0) AS n FROM invoices WHERE status = 'completed' AND completed_at >= ?",
        awalBulan,
      ).n,
    },
  });
});

// ---------------------------------------------------------------------------
// Pengguna
// ---------------------------------------------------------------------------

router.get('/users', (req, res) => {
  const daftar = db
    .prepare(
      `SELECT u.*, (SELECT COUNT(*) FROM servers s WHERE s.user_id = u.id) AS server_count
       FROM users u WHERE u.name LIKE ? OR u.email LIKE ? ORDER BY u.id DESC LIMIT 200`,
    )
    .all(cari(req.query.q), cari(req.query.q));

  res.json({
    success: true,
    users: daftar.map((u) => ({ ...publicUser(u), banned: Boolean(u.banned), serverCount: u.server_count })),
  });
});

function ambilUser(id) {
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(Number(id));
  if (!user) gagal(404, 'Pengguna tidak ditemukan.');
  return user;
}

router.post('/users/:id/balance', (req, res) => {
  const user = ambilUser(req.params.id);
  const amount = bulat(req.body?.amount, { nama: 'Nominal', min: -100_000_000, max: 100_000_000 });
  if (amount === 0) gagal(400, 'Nominal tidak boleh 0.');
  const note = teks(req.body?.note, { nama: 'Catatan', max: 200, wajib: false });

  const saldo = db.transaction(() =>
    ubahSaldo(user.id, amount, 'adjust', note || `Penyesuaian saldo oleh admin (${amount > 0 ? '+' : ''}${rupiah(amount)})`),
  )();
  res.json({ success: true, balance: saldo });
});

router.post('/users/:id/ban', async (req, res) => {
  const user = ambilUser(req.params.id);
  if (user.id === req.user.id) gagal(400, 'Tidak bisa menonaktifkan akun sendiri.');
  const banned = Boolean(req.body?.banned);

  db.prepare('UPDATE users SET banned = ? WHERE id = ?').run(banned ? 1 : 0, user.id);
  if (banned) {
    db.prepare('DELETE FROM sessions WHERE user_id = ?').run(user.id);
    // Bot milik akun yang dinonaktifkan ikut dimatikan
    for (const { id } of db.prepare('SELECT id FROM servers WHERE user_id = ?').all(user.id)) {
      db.prepare('UPDATE servers SET enabled = 0 WHERE id = ?').run(id);
      await manager.stop(id, { pesan: 'Akun dinonaktifkan admin.' });
    }
  }
  res.json({ success: true });
});

router.post('/users/:id/role', (req, res) => {
  const user = ambilUser(req.params.id);
  if (user.id === req.user.id) gagal(400, 'Tidak bisa mengubah peran akun sendiri.');
  const role = req.body?.role === 'admin' ? 'admin' : 'user';
  db.prepare('UPDATE users SET role = ? WHERE id = ?').run(role, user.id);
  res.json({ success: true, isAdmin: isAdmin({ ...user, role }) });
});

// ---------------------------------------------------------------------------
// Top up
// ---------------------------------------------------------------------------

router.get('/topups', (req, res) => {
  const status = ['pending', 'approved', 'rejected', 'cancelled'].includes(req.query.status) ? req.query.status : null;
  const daftar = db
    .prepare(
      `SELECT t.*, u.name AS user_name, u.email AS user_email FROM topups t JOIN users u ON u.id = t.user_id
       ${status ? 'WHERE t.status = ?' : ''} ORDER BY t.id DESC LIMIT 200`,
    )
    .all(...(status ? [status] : []));
  res.json({ success: true, topups: daftar });
});

function prosesTopup(req, setuju) {
  const note = teks(req.body?.note, { nama: 'Catatan', max: 200, wajib: false });

  db.transaction(() => {
    const topup = db.prepare('SELECT * FROM topups WHERE id = ?').get(Number(req.params.id));
    if (!topup) gagal(404, 'Top up tidak ditemukan.');
    if (topup.status !== 'pending') gagal(400, 'Top up ini sudah diproses.');

    db.prepare('UPDATE topups SET status = ?, admin_note = ?, processed_at = ?, processed_by = ? WHERE id = ?').run(
      setuju ? 'approved' : 'rejected',
      note,
      Date.now(),
      req.user.id,
      topup.id,
    );
    if (setuju) ubahSaldo(topup.user_id, topup.amount, 'topup', `Top up #${topup.id} via ${topup.method}`);
  })();
}

router.post('/topups/:id/approve', (req, res) => {
  prosesTopup(req, true);
  res.json({ success: true });
});

router.post('/topups/:id/reject', (req, res) => {
  prosesTopup(req, false);
  res.json({ success: true });
});

// ---------------------------------------------------------------------------
// Paket
// ---------------------------------------------------------------------------

router.get('/packages', (_req, res) => {
  const daftar = db
    .prepare(
      `SELECT p.*, (SELECT COUNT(*) FROM servers s WHERE s.package_id = p.id) AS server_count
       FROM packages p ORDER BY p.sort, p.price`,
    )
    .all();
  res.json({ success: true, packages: daftar });
});

function rapikanPaket(body) {
  return {
    name: teks(body?.name, { nama: 'Nama paket', max: 40 }),
    description: teks(body?.description, { nama: 'Deskripsi', max: 300, wajib: false }),
    days: bulat(body?.days, { nama: 'Durasi', min: 1, max: 3650 }),
    price: bulat(body?.price, { nama: 'Harga', min: 0, max: 100_000_000 }),
    active: body?.active === undefined ? 1 : body.active ? 1 : 0,
    sort: bulat(body?.sort ?? 0, { nama: 'Urutan', min: 0, max: 1000 }),
  };
}

router.post('/packages', (req, res) => {
  const p = rapikanPaket(req.body);
  const hasil = db
    .prepare('INSERT INTO packages (name, description, days, price, active, sort, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(p.name, p.description, p.days, p.price, p.active, p.sort, Date.now());
  res.status(201).json({ success: true, id: hasil.lastInsertRowid });
});

router.put('/packages/:id', (req, res) => {
  const p = rapikanPaket(req.body);
  const hasil = db
    .prepare('UPDATE packages SET name = ?, description = ?, days = ?, price = ?, active = ?, sort = ? WHERE id = ?')
    .run(p.name, p.description, p.days, p.price, p.active, p.sort, Number(req.params.id));
  if (!hasil.changes) gagal(404, 'Paket tidak ditemukan.');
  res.json({ success: true });
});

router.delete('/packages/:id', (req, res) => {
  const id = Number(req.params.id);
  const dipakai = db.prepare('SELECT COUNT(*) AS n FROM servers WHERE package_id = ?').get(id).n;
  // Paket yang sudah dipakai server cukup disembunyikan, supaya riwayat tetap utuh
  if (dipakai) db.prepare('UPDATE packages SET active = 0 WHERE id = ?').run(id);
  else db.prepare('DELETE FROM packages WHERE id = ?').run(id);
  res.json({ success: true, hidden: Boolean(dipakai) });
});

// ---------------------------------------------------------------------------
// Server
// ---------------------------------------------------------------------------

router.get('/servers', (req, res) => {
  const daftar = db
    .prepare(
      `SELECT s.*, u.name AS user_name, u.email AS user_email FROM servers s JOIN users u ON u.id = s.user_id
       WHERE s.name LIKE ? OR u.email LIKE ? OR IFNULL(s.phone, '') LIKE ? ORDER BY s.id DESC LIMIT 300`,
    )
    .all(cari(req.query.q), cari(req.query.q), cari(req.query.q));
  res.json({
    success: true,
    servers: daftar.map((s) => ({ ...bentukServer(s), owner: { id: s.user_id, name: s.user_name, email: s.user_email } })),
  });
});

function ambilServerAdmin(id) {
  const server = db.prepare('SELECT * FROM servers WHERE id = ?').get(Number(id));
  if (!server) gagal(404, 'Server tidak ditemukan.');
  return server;
}

router.post('/servers/:id/extend', (req, res) => {
  const server = ambilServerAdmin(req.params.id);
  const days = bulat(req.body?.days, { nama: 'Jumlah hari', min: -3650, max: 3650 });
  if (days === 0) gagal(400, 'Jumlah hari tidak boleh 0.');
  const dasar = days > 0 ? Math.max(Date.now(), server.expires_at) : server.expires_at;
  db.prepare('UPDATE servers SET expires_at = ? WHERE id = ?').run(dasar + days * HARI_MS, server.id);
  res.json({ success: true });
});

router.post('/servers/:id/stop', async (req, res) => {
  const server = ambilServerAdmin(req.params.id);
  db.prepare('UPDATE servers SET enabled = 0 WHERE id = ?').run(server.id);
  await manager.stop(server.id, { pesan: 'Dimatikan oleh admin.' });
  res.json({ success: true });
});

router.post('/servers/:id/start', (req, res) => {
  const server = ambilServerAdmin(req.params.id);
  if (!server.phone) gagal(400, 'Server belum terhubung ke nomor.');
  if (server.expires_at <= Date.now()) gagal(400, 'Masa aktif server habis.');
  if (manager.isRunning(server.id)) gagal(409, 'Bot sudah berjalan.');
  db.prepare('UPDATE servers SET enabled = 1 WHERE id = ?').run(server.id);
  manager.start({ ...server, enabled: 1 });
  res.json({ success: true });
});

router.get('/servers/:id/logs', (req, res) => {
  const server = ambilServerAdmin(req.params.id);
  res.json({ success: true, logs: manager.logs(server.id, Number(req.query.after) || 0) });
});

// ---------------------------------------------------------------------------
// Tagihan QRIS
// ---------------------------------------------------------------------------

const POLA_ORDER = /^VJ\d{6}[A-Z2-9]{6}$/;

function invoiceAdminById(orderId) {
  if (!POLA_ORDER.test(String(orderId || ''))) gagal(404, 'Invoice tidak ditemukan.');
  const inv = db.prepare('SELECT * FROM invoices WHERE order_id = ?').get(orderId);
  if (!inv) gagal(404, 'Invoice tidak ditemukan.');
  return inv;
}

router.get('/invoices', (req, res) => {
  const { status, kind } = req.query;
  const q = cari(req.query.q);
  const syarat = [];
  const params = [];
  if (status === 'perhatian') {
    syarat.push("i.status != 'completed' AND i.handled_at IS NULL AND (i.recheck = 1 OR i.note != '')");
  } else if (['pending', 'completed', 'expired', 'cancelled'].includes(status)) {
    syarat.push('i.status = ?');
    params.push(status);
  }
  if (['topup', 'buy', 'renew'].includes(kind)) {
    syarat.push('i.kind = ?');
    params.push(kind);
  }
  if (req.query.q) {
    syarat.push('(i.order_id LIKE ? OR IFNULL(i.gateway_trx_id, \'\') LIKE ? OR u.email LIKE ? OR u.name LIKE ?)');
    params.push(q, q, q, q);
  }
  const where = syarat.length ? `WHERE ${syarat.join(' AND ')}` : '';
  const rows = db
    .prepare(`SELECT i.* FROM invoices i JOIN users u ON u.id = i.user_id ${where} ORDER BY i.id DESC LIMIT 200`)
    .all(...params);
  res.json({ success: true, invoices: rows.map(bentukInvoiceAdmin) });
});

router.post('/invoices/:orderId/check', async (req, res) => {
  const inv = invoiceAdminById(req.params.orderId);
  if (!qrisAktif()) gagal(400, 'QRIS tidak aktif.');
  let hasil;
  try {
    hasil = await cekDanProses(inv, { paksa: true, sumber: 'admin' });
  } catch (e) {
    if (e instanceof GatewayError) gagal(502, 'Gateway tidak bisa dihubungi. Coba lagi nanti.', { code: 'GATEWAY_ERROR' });
    throw e;
  }
  const h = hasil ?? db.prepare('SELECT * FROM invoices WHERE id = ?').get(inv.id);
  let message;
  if (h.status === 'completed') {
    message = inv.status === 'completed' ? 'Invoice sudah lunas sebelumnya.' : 'Pembayaran terkonfirmasi, invoice diselesaikan.';
  } else if (h.note && h.note.startsWith('Nominal')) message = 'Nominal di gateway tidak cocok, cek manual.';
  else if (h.status === 'pending') message = 'Gateway: belum dibayar.';
  else message = 'Gateway: kedaluwarsa/dibatalkan.';
  res.json({ success: true, gatewayStatus: h.gateway_status, invoice: bentukInvoiceAdmin(h), message });
});

router.post('/invoices/:orderId/dismiss', (req, res) => {
  const inv = invoiceAdminById(req.params.orderId);
  const note = teks(req.body?.note, { nama: 'Catatan', max: 200, wajib: false });
  db.prepare('UPDATE invoices SET recheck = 0, handled_at = ?, note = ? WHERE id = ?').run(
    Date.now(),
    `[ditandai selesai oleh admin] ${note}`,
    inv.id,
  );
  res.json({ success: true });
});

// ---------------------------------------------------------------------------
// Pengaturan situs
// ---------------------------------------------------------------------------

router.get('/settings', (_req, res) => {
  res.json({
    success: true,
    settings: semuaPengaturan(),
    qris: {
      enabled: qrisAktif(),
      simulasi: modeSimulasi(),
      webhookUrl: env.baseUrl ? `${env.baseUrl}/api/payment/webhook` : '',
    },
  });
});

router.put('/settings', (req, res) => {
  const b = req.body ?? {};
  const qris = teks(b.payment_qris_url, { nama: 'URL gambar QRIS', max: 500, wajib: false });
  if (qris && !/^(https?:\/\/|\/)/i.test(qris)) gagal(400, 'URL gambar QRIS harus diawali https:// atau /');

  simpanPengaturan({
    payment_instructions: teks(b.payment_instructions, { nama: 'Instruksi pembayaran', max: 2000, wajib: false }),
    payment_qris_url: qris,
    contact_whatsapp: teks(b.contact_whatsapp, { nama: 'Kontak WhatsApp', max: 20, wajib: false }).replace(/\D/g, ''),
    min_topup: bulat(b.min_topup, { nama: 'Minimal top up', min: 1000, max: 10_000_000 }),
    announcement: teks(b.announcement, { nama: 'Pengumuman', max: 500, wajib: false }),
    qris_fee: bulat(b.qris_fee ?? semuaPengaturan().qris_fee, { nama: 'Biaya admin QRIS', min: 0, max: 50_000 }),
    qris_min_amount: bulat(b.qris_min_amount ?? semuaPengaturan().qris_min_amount, { nama: 'Minimal pembayaran QRIS', min: 1000, max: 1_000_000 }),
    manual_topup: b.manual_topup === undefined ? semuaPengaturan().manual_topup : b.manual_topup ? '1' : '0',
  });
  res.json({ success: true, settings: semuaPengaturan() });
});

export default router;

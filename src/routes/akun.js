import { Router } from 'express';
import { db, semuaPengaturan } from '../db.js';
import { hashPassword, verifyPassword, publicUser, wajibLogin, pembatas } from '../auth.js';
import { qrisAktif, modeSimulasi } from '../payment.js';
import { biayaAdmin, minimalQris, topupManualAktif, bentukInvoice, tutupInvoice, INVOICE_TTL_MS } from '../pembayaran.js';
import { gagal, teks, bulat } from '../util.js';

const router = Router();

// ---------------------------------------------------------------------------
// Publik
// ---------------------------------------------------------------------------

router.get('/packages', (_req, res) => {
  const paket = db
    .prepare('SELECT id, code, name, size_label AS sizeLabel, description, days, price FROM packages WHERE active = 1 ORDER BY sort, price')
    .all();
  res.json({ success: true, packages: paket });
});

router.get('/publik/ringkasan', (_req, res) => {
  const serverAktif = db.prepare('SELECT COUNT(*) AS n FROM servers WHERE phone IS NOT NULL AND expires_at > ?').get(Date.now()).n;
  res.json({ success: true, serverAktif });
});

router.get('/site', (_req, res) => {
  const s = semuaPengaturan();
  res.json({
    success: true,
    site: {
      contactWhatsapp: s.contact_whatsapp,
      announcement: s.announcement,
      paymentInstructions: s.payment_instructions,
      paymentQrisUrl: s.payment_qris_url,
      minTopup: Number(s.min_topup) || 0,
      qris: {
        enabled: qrisAktif(),
        simulasi: modeSimulasi(),
        fee: biayaAdmin(),
        minAmount: minimalQris(),
        ttlMinutes: Math.round(INVOICE_TTL_MS / 60000),
      },
      manualTopup: topupManualAktif(),
    },
  });
});

// ---------------------------------------------------------------------------
// Akun
// ---------------------------------------------------------------------------

router.put('/account', wajibLogin, (req, res) => {
  const name = teks(req.body?.name, { nama: 'Nama', min: 2, max: 60 });
  db.prepare('UPDATE users SET name = ? WHERE id = ?').run(name, req.user.id);
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  res.json({ success: true, user: publicUser(user) });
});

const batasSandi = pembatas({ batas: 10, jendelaMs: 15 * 60 * 1000, kunci: (req) => `sandi|${req.user?.id}` });

router.put('/account/password', wajibLogin, batasSandi, async (req, res) => {
  const baru = teks(req.body?.newPassword, { nama: 'Kata sandi baru', min: 8, max: 200 });

  // Akun Google yang belum punya sandi boleh langsung membuat sandi
  if (req.user.password_hash) {
    const lama = teks(req.body?.currentPassword, { nama: 'Kata sandi lama', max: 200 });
    if (!(await verifyPassword(lama, req.user.password_hash))) gagal(400, 'Kata sandi lama salah.');
  }

  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(await hashPassword(baru), req.user.id);
  // Keluarkan sesi lain (perangkat lain) demi keamanan
  db.prepare('DELETE FROM sessions WHERE user_id = ? AND id != ?').run(req.user.id, req.sessionId);
  res.json({ success: true, message: 'Kata sandi berhasil diubah.' });
});

// ---------------------------------------------------------------------------
// Saldo & top up
// ---------------------------------------------------------------------------

router.get('/wallet', wajibLogin, async (req, res) => {
  const transaksi = db
    .prepare('SELECT id, type, amount, balance_after, description, created_at FROM transactions WHERE user_id = ? ORDER BY id DESC LIMIT 50')
    .all(req.user.id);
  const topup = db
    .prepare('SELECT id, amount, method, note, status, admin_note, created_at, processed_at FROM topups WHERE user_id = ? ORDER BY id DESC LIMIT 30')
    .all(req.user.id);

  // Tagihan QRIS (tanpa menunggu gateway). Yang masih pending tapi sudah lewat
  // waktu ditutup di latar; UI menganggap expiresAt <= now = "sedang ditutup".
  const barisInvoice = db
    .prepare('SELECT * FROM invoices WHERE user_id = ? ORDER BY id DESC LIMIT 30')
    .all(req.user.id);
  const invoices = await Promise.all(barisInvoice.map((inv) => bentukInvoice(inv)));
  const pendingRow = barisInvoice.find((inv) => inv.status === 'pending');
  if (pendingRow && pendingRow.expires_at <= Date.now()) {
    tutupInvoice(pendingRow, 'expired').catch((e) => console.error('[wallet] tutup', e.message));
  }
  const pendingInvoice = pendingRow ? await bentukInvoice(pendingRow, { denganQr: true }) : null;

  res.json({ success: true, balance: req.user.balance, transactions: transaksi, topups: topup, invoices, pendingInvoice });
});

const batasTopup = pembatas({ batas: 10, jendelaMs: 60 * 60 * 1000, kunci: (req) => `topup|${req.user?.id}` });

router.post('/topups', wajibLogin, batasTopup, (req, res) => {
  if (!topupManualAktif()) gagal(403, 'Top up manual dinonaktifkan admin. Pakai QRIS otomatis.');
  const minimal = Number(semuaPengaturan().min_topup) || 1000;
  const amount = bulat(req.body?.amount, { nama: 'Nominal', min: minimal, max: 10_000_000 });
  const method = teks(req.body?.method, { nama: 'Metode pembayaran', max: 40 });
  const note = teks(req.body?.note, { nama: 'Catatan', max: 300, wajib: false });

  const menunggu = db.prepare("SELECT COUNT(*) AS n FROM topups WHERE user_id = ? AND status = 'pending'").get(req.user.id).n;
  if (menunggu >= 3) gagal(400, 'Masih ada 3 top up yang menunggu dicek admin. Tunggu dulu ya.');

  const hasil = db
    .prepare('INSERT INTO topups (user_id, amount, method, note, created_at) VALUES (?, ?, ?, ?, ?)')
    .run(req.user.id, amount, method, note, Date.now());
  res.status(201).json({ success: true, id: hasil.lastInsertRowid, message: 'Permintaan top up dikirim. Saldo masuk setelah dicek admin.' });
});

router.post('/topups/:id/cancel', wajibLogin, (req, res) => {
  const hasil = db
    .prepare("UPDATE topups SET status = 'cancelled', processed_at = ? WHERE id = ? AND user_id = ? AND status = 'pending'")
    .run(Date.now(), Number(req.params.id), req.user.id);
  if (!hasil.changes) gagal(404, 'Top up tidak ditemukan atau sudah diproses.');
  res.json({ success: true });
});

export default router;

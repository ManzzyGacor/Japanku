import { Router } from 'express';
import { db } from '../db.js';
import { wajibLogin, pembatas } from '../auth.js';
import { paketAktif, snapshotPaket } from '../toko.js';
import { modeSimulasi } from '../payment.js';
import {
  buatInvoice,
  bentukInvoice,
  cekDanProses,
  tutupInvoice,
  simulasiBayarInvoice,
  minimalQris,
} from '../pembayaran.js';
import { gagal, teks, bulat } from '../util.js';

const router = Router();
router.use(wajibLogin);

const batasQris = pembatas({ batas: 10, jendelaMs: 10 * 60 * 1000, kunci: (req) => `qris|${req.user?.id}` });
const batasBatal = pembatas({ batas: 20, jendelaMs: 10 * 60 * 1000, kunci: (req) => `qris-batal|${req.user?.id}` });

const POLA_ORDER = /^VJ\d{6}[A-Z2-9]{6}$/;

function invoiceMilikku(req) {
  const orderId = String(req.params.orderId || '');
  if (!POLA_ORDER.test(orderId)) gagal(404, 'Invoice tidak ditemukan.');
  const inv = db.prepare('SELECT * FROM invoices WHERE order_id = ? AND user_id = ?').get(orderId, req.user.id);
  if (!inv) gagal(404, 'Invoice tidak ditemukan.');
  return inv;
}

// ---------------------------------------------------------------------------
// Membuat tagihan
// ---------------------------------------------------------------------------

router.post('/topup', batasQris, async (req, res) => {
  const amount = bulat(req.body?.amount, { nama: 'Nominal', min: Math.max(minimalQris(), 1000), max: 10_000_000 });
  const inv = await buatInvoice({ user: req.user, kind: 'topup', subtotal: amount, purpose: {} });
  res.status(201).json({ success: true, invoice: await bentukInvoice(inv, { denganQr: true }) });
});

function hitungSubtotal(harga, saldo) {
  // Bayar selisih harga - saldo, minimal sesuai minimum gateway. Kelebihan jadi saldo.
  return Math.max(harga - saldo, minimalQris());
}

router.post('/buy', batasQris, async (req, res) => {
  const paket = paketAktif(req.body?.packageId);
  const name = teks(req.body?.name, { nama: 'Nama server', max: 40, wajib: false });
  if (req.user.balance >= paket.price) {
    gagal(400, 'Saldo kamu cukup untuk paket ini. Beli langsung pakai saldo.', { code: 'SALDO_CUKUP' });
  }
  const subtotal = hitungSubtotal(paket.price, req.user.balance);
  const inv = await buatInvoice({
    user: req.user,
    kind: 'buy',
    subtotal,
    purpose: { paket: snapshotPaket(paket), name, saldoAwal: req.user.balance },
  });
  res.status(201).json({ success: true, invoice: await bentukInvoice(inv, { denganQr: true }) });
});

router.post('/renew', batasQris, async (req, res) => {
  const server = db.prepare('SELECT * FROM servers WHERE id = ? AND user_id = ?').get(Number(req.body?.serverId), req.user.id);
  if (!server) gagal(404, 'Server tidak ditemukan.');
  const paket = paketAktif(req.body?.packageId);
  if (req.user.balance >= paket.price) {
    gagal(400, 'Saldo kamu cukup. Perpanjang langsung pakai saldo.', { code: 'SALDO_CUKUP' });
  }
  const subtotal = hitungSubtotal(paket.price, req.user.balance);
  const inv = await buatInvoice({
    user: req.user,
    kind: 'renew',
    subtotal,
    serverId: server.id,
    purpose: { paket: snapshotPaket(paket), serverName: server.name, saldoAwal: req.user.balance },
  });
  res.status(201).json({ success: true, invoice: await bentukInvoice(inv, { denganQr: true }) });
});

// ---------------------------------------------------------------------------
// Lihat / batalkan
// ---------------------------------------------------------------------------

router.get('/invoices/:orderId', async (req, res) => {
  let inv = invoiceMilikku(req);
  if (inv.status === 'pending') inv = (await cekDanProses(inv, { sumber: 'poll' })) ?? inv;
  res.json({ success: true, invoice: await bentukInvoice(inv, { denganQr: req.query.qr === '1' }) });
});

router.post('/invoices/:orderId/cancel', batasBatal, async (req, res) => {
  const inv = invoiceMilikku(req);
  if (inv.status === 'completed') {
    gagal(409, 'Invoice ini sudah dibayar, tidak bisa dibatalkan.', { code: 'INVOICE_SUDAH_LUNAS' });
  }
  if (inv.status === 'expired' || inv.status === 'cancelled') {
    gagal(400, 'Invoice ini sudah ditutup.', { code: 'INVOICE_TUTUP' });
  }
  const hasil = await tutupInvoice(inv, 'cancelled');
  if (hasil?.status === 'completed') {
    return res.status(409).json({
      success: false,
      message: 'Invoice ini sudah dibayar, tidak bisa dibatalkan.',
      code: 'INVOICE_SUDAH_LUNAS',
      invoice: await bentukInvoice(hasil),
    });
  }
  res.json({ success: true, message: 'Invoice dibatalkan.', invoice: await bentukInvoice(hasil ?? inv) });
});

// Hanya mode simulasi: bayar tagihan tanpa gateway sungguhan.
router.post('/invoices/:orderId/simulasi-bayar', async (req, res) => {
  if (!modeSimulasi()) gagal(404, 'Endpoint tidak ditemukan.');
  const inv = invoiceMilikku(req);
  const hasil = await simulasiBayarInvoice(inv);
  res.json({ success: true, invoice: await bentukInvoice(hasil) });
});

export default router;

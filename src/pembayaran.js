import crypto from 'crypto';
import QRCode from 'qrcode';
import { db, ubahSaldo, SaldoKurang, semuaPengaturan } from './db.js';
import {
  buatQris,
  cekStatusQris,
  batalkanQris,
  verifikasiSignature,
  qrisAktif,
  modeSimulasi,
  simulasiBayar,
  GatewayError,
} from './payment.js';
import { beliDariSaldo, perpanjangDariSaldo, nyalakanSetelahPerpanjang } from './toko.js';
import { gagal } from './util.js';

/*
 Domain tagihan (invoice) QRIS: membuat, menutup, memeriksa, dan menyelesaikan.
 Satu tagihan menunggu per pengguna. Tagihan hangus 5 menit. Pembayaran
 diverifikasi ulang ke gateway sebelum diaktifkan. Penyelesaian idempoten &
 atomik (satu-satunya tempat saldo bertambah dari QRIS).
*/

export const INVOICE_TTL_MS = 5 * 60 * 1000;
const CEK_JEDA_POLL_MS = 5_000;
const RECHECK_JENDELA_MS = 24 * 60 * 60 * 1000;
const SAPU_JEDA_MS = 20_000;
const ABJAD = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

// ---------------------------------------------------------------------------
// Pengaturan turunan
// ---------------------------------------------------------------------------

export function biayaAdmin() {
  return Math.min(50_000, Math.max(0, Number(semuaPengaturan().qris_fee) || 0));
}
export function minimalQris() {
  return Number(semuaPengaturan().qris_min_amount) || 1000;
}
export function topupManualAktif() {
  return !qrisAktif() || semuaPengaturan().manual_topup === '1';
}

// ---------------------------------------------------------------------------
// Kunci per-invoice (urutkan poll, webhook, timer, cancel, cek admin)
// ---------------------------------------------------------------------------

const antrean = new Map();
export function denganKunci(kunci, fn) {
  const berikut = (antrean.get(kunci) ?? Promise.resolve()).catch(() => {}).then(fn);
  antrean.set(kunci, berikut);
  const lepas = () => {
    if (antrean.get(kunci) === berikut) antrean.delete(kunci);
  };
  berikut.then(lepas, lepas);
  return berikut;
}
const sedangMembuat = new Set();

const ambil = (id) => db.prepare('SELECT * FROM invoices WHERE id = ?').get(id);
const ambilByOrder = (orderId) => db.prepare('SELECT * FROM invoices WHERE order_id = ?').get(orderId);

function orderIdBaru() {
  const d = new Date();
  const stamp = `${String(d.getFullYear()).slice(2)}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
  let acak = '';
  for (let i = 0; i < 6; i += 1) acak += ABJAD[crypto.randomInt(ABJAD.length)];
  return `VJ${stamp}${acak}`;
}

// ---------------------------------------------------------------------------
// Membuat tagihan
// ---------------------------------------------------------------------------

export async function invoiceMenghalangi(userId) {
  let row = db.prepare("SELECT * FROM invoices WHERE user_id = ? AND status = 'pending'").get(userId);
  if (row && row.expires_at <= Date.now()) {
    await tutupInvoice(row, 'expired');
    row = db.prepare("SELECT * FROM invoices WHERE user_id = ? AND status = 'pending'").get(userId);
  }
  return row ?? null;
}

/**
 * Buat tagihan + QRIS. kind: 'topup' | 'buy' | 'renew'.
 * @returns {Promise<object>} baris invoice
 */
export async function buatInvoice({ user, kind, subtotal, purpose = {}, serverId = null }) {
  if (!qrisAktif()) gagal(503, 'Pembayaran QRIS otomatis belum diaktifkan.', { code: 'QRIS_NONAKTIF' });
  if (sedangMembuat.has(user.id)) gagal(409, 'QRIS sedang dibuat, tunggu sebentar.', { code: 'SEDANG_DIBUAT' });

  sedangMembuat.add(user.id);
  try {
    const halangan = await invoiceMenghalangi(user.id);
    if (halangan) {
      gagal(409, 'Masih ada pembayaran yang belum selesai. Selesaikan atau batalkan dulu sebelum membuat QRIS baru.', {
        code: 'PENDING_EXISTS',
        orderId: halangan.order_id,
      });
    }

    const fee = biayaAdmin();
    const amount = subtotal + fee;

    let qris;
    try {
      qris = await buatQris(amount);
    } catch (err) {
      if (err instanceof GatewayError) {
        gagal(502, `Gateway pembayaran sedang gangguan. Coba lagi beberapa menit lagi${topupManualAktif() ? ', atau pakai top up manual.' : '.'}`, { code: 'GATEWAY_ERROR' });
      }
      throw err;
    }
    if (qris.amount !== amount) {
      await batalkanQris(qris.transactionId);
      console.warn(`[pembayaran] nominal gateway ${qris.amount} != tagihan ${amount}`);
      gagal(502, 'Nominal dari gateway tidak sesuai. Coba lagi.', { code: 'GATEWAY_ERROR' });
    }

    const sekarang = Date.now();
    const gateway = modeSimulasi() ? 'simulasi' : 'autogopay';
    let percobaan = 0;
    while (true) {
      const orderId = orderIdBaru();
      try {
        const hasil = db
          .prepare(
            `INSERT INTO invoices
             (order_id, user_id, kind, purpose, server_id, subtotal, fee, amount, gateway,
              gateway_trx_id, gateway_order_id, qr_string, qr_url, checkout_url, expires_at, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .run(
            orderId,
            user.id,
            kind,
            JSON.stringify(purpose),
            serverId,
            subtotal,
            fee,
            amount,
            gateway,
            qris.transactionId,
            qris.orderId || '',
            qris.qrString,
            qris.qrUrl,
            qris.checkoutUrl,
            sekarang + INVOICE_TTL_MS,
            sekarang,
          );
        const inv = ambil(hasil.lastInsertRowid);
        setTimeout(() => void kedaluwarsakan(orderId), INVOICE_TTL_MS + 500).unref();
        console.log(`[pembayaran] ${orderId} dibuat (${kind}, Rp${amount})`);
        return inv;
      } catch (err) {
        const unik = String(err.code).startsWith('SQLITE_CONSTRAINT');
        // Tabrakan order_id: coba lagi sampai 3x. Tabrakan partial-index (sudah ada
        // pending) atau trx id: batalkan QR baru, lempar PENDING_EXISTS.
        if (unik && String(err.message).includes('order_id') && percobaan < 3) {
          percobaan += 1;
          continue;
        }
        await batalkanQris(qris.transactionId);
        if (unik) {
          const ada = db.prepare("SELECT order_id FROM invoices WHERE user_id = ? AND status = 'pending'").get(user.id);
          gagal(409, 'Masih ada pembayaran yang belum selesai. Selesaikan atau batalkan dulu sebelum membuat QRIS baru.', {
            code: 'PENDING_EXISTS',
            orderId: ada?.order_id,
          });
        }
        throw err;
      }
    }
  } finally {
    sedangMembuat.delete(user.id);
  }
}

async function kedaluwarsakan(orderId) {
  const row = ambilByOrder(orderId);
  if (row?.status === 'pending') await tutupInvoice(row, 'expired');
}

// ---------------------------------------------------------------------------
// Menutup & memeriksa
// ---------------------------------------------------------------------------

async function tutupInvoiceInner(inv, statusAkhir) {
  const row = ambil(inv.id);
  if (!row || row.status !== 'pending') return row;

  const g = await cekStatusQris(row.gateway_trx_id);
  db.prepare('UPDATE invoices SET checked_at = ?, gateway_status = ? WHERE id = ?').run(
    Date.now(),
    g.status === 'unknown' ? 'error' : g.mentah,
    row.id,
  );

  if (g.status === 'completed' && (g.amount === null || g.amount === row.amount)) {
    return selesaikanInvoice(row.id, { sumber: 'cek-tutup' });
  }

  const batal = await batalkanQris(row.gateway_trx_id);
  const recheck = g.status === 'unknown' || !batal ? 1 : 0;
  db.prepare("UPDATE invoices SET status = ?, closed_at = ?, recheck = ? WHERE id = ? AND status = 'pending'").run(
    statusAkhir,
    Date.now(),
    recheck,
    row.id,
  );
  console.log(`[pembayaran] ${row.order_id} -> ${statusAkhir}${recheck ? ' (recheck)' : ''}`);
  return ambil(row.id);
}

export function tutupInvoice(inv, statusAkhir) {
  return denganKunci(inv.order_id, () => tutupInvoiceInner(inv, statusAkhir));
}

async function cekDanProsesInner(inv, { paksa = false }) {
  let row = ambil(inv.id);
  if (!row || row.status === 'completed') return row;
  if (row.status === 'pending' && row.expires_at <= Date.now()) return tutupInvoiceInner(row, 'expired');
  if (!paksa && row.checked_at && Date.now() - row.checked_at < CEK_JEDA_POLL_MS) return row;

  const g = await cekStatusQris(row.gateway_trx_id);
  db.prepare('UPDATE invoices SET checked_at = ?, gateway_status = ? WHERE id = ?').run(
    Date.now(),
    g.status === 'unknown' ? 'error' : g.mentah,
    row.id,
  );

  if (g.status === 'completed') {
    if (g.amount !== null && g.amount !== row.amount) {
      db.prepare('UPDATE invoices SET note = ?, recheck = 0 WHERE id = ?').run(
        `Nominal di gateway Rp${g.amount} tidak sama dengan tagihan Rp${row.amount}.`,
        row.id,
      );
      console.warn(`[pembayaran] ${row.order_id} nominal gateway tidak cocok`);
      return ambil(row.id);
    }
    return selesaikanInvoice(row.id, { sumber: 'cek' });
  }

  if ((g.status === 'expired' || g.status === 'cancelled') && row.status === 'pending') {
    db.prepare('UPDATE invoices SET status = ?, closed_at = ? WHERE id = ? AND status = ?').run(
      g.status,
      Date.now(),
      row.id,
      'pending',
    );
  }
  // Tagihan yang sudah tutup & lewat 24 jam: berhenti recheck.
  row = ambil(row.id);
  if (row.status !== 'pending' && row.recheck && row.closed_at && Date.now() - row.closed_at > RECHECK_JENDELA_MS) {
    db.prepare('UPDATE invoices SET recheck = 0 WHERE id = ?').run(row.id);
  }
  return ambil(row.id);
}

export function cekDanProses(inv, opsi = {}) {
  return denganKunci(inv.order_id, () => cekDanProsesInner(inv, opsi));
}

// ---------------------------------------------------------------------------
// Menyelesaikan (satu-satunya tempat invoice jadi 'completed')
// ---------------------------------------------------------------------------

const selesaikanTx = db.transaction((invoiceId, { paidAt }) => {
  const inv = ambil(invoiceId);
  if (!inv || inv.status === 'completed') return { sudah: true, inv };

  const now = Date.now();
  const telat = inv.status !== 'pending';
  const u = db
    .prepare(
      `UPDATE invoices SET status='completed', completed_at=?, paid_at=?, gateway_status='settlement', recheck=0
       WHERE id=? AND status != 'completed'`,
    )
    .run(now, paidAt ?? now, inv.id);
  if (u.changes !== 1) return { sudah: true, inv };

  ubahSaldo(inv.user_id, inv.subtotal, 'topup', `Pembayaran QRIS ${inv.order_id}${telat ? ' (dibayar setelah invoice ditutup)' : ''}`);

  const tujuan = JSON.parse(inv.purpose || '{}');
  let result = 'ok';
  let resultNote = '';
  let serverId = inv.server_id;
  let efek = null;
  try {
    if (inv.kind === 'buy') {
      serverId = beliDariSaldo(inv.user_id, { paket: tujuan.paket, name: tujuan.name });
    } else if (inv.kind === 'renew') {
      const server = inv.server_id && db.prepare('SELECT * FROM servers WHERE id = ? AND user_id = ?').get(inv.server_id, inv.user_id);
      if (!server) {
        result = 'saldo_only';
        resultNote = 'Server yang mau diperpanjang sudah dihapus. Dana sudah masuk ke saldo kamu.';
      } else {
        perpanjangDariSaldo(inv.user_id, server, tujuan.paket);
        efek = { renew: server };
      }
    }
  } catch (e) {
    result = 'saldo_only';
    if (e instanceof SaldoKurang) {
      resultNote = `Saldo kamu terpakai untuk transaksi lain sebelum pembayaran masuk, jadi ${inv.kind === 'buy' ? 'server belum dibeli' : 'server belum diperpanjang'}. Dana sudah masuk ke saldo kamu.`;
    } else {
      resultNote = `${inv.kind === 'buy' ? 'Server gagal dibuat otomatis' : 'Server gagal diperpanjang otomatis'}. Dana sudah masuk ke saldo kamu, lanjutkan pakai saldo.`;
      console.error('[pembayaran] fulfilment gagal', inv.order_id, e);
    }
  }
  db.prepare('UPDATE invoices SET result=?, result_note=?, server_id=? WHERE id=?').run(result, resultNote, serverId ?? null, inv.id);
  return { sudah: false, inv: ambil(inv.id), efek };
});

export function selesaikanInvoice(id, opsi = {}) {
  const h = selesaikanTx.immediate(id, opsi);
  if (!h.sudah) {
    console.log(`[pembayaran] ${h.inv.order_id} lunas (${h.inv.kind}, ${opsi.sumber}) -> ${h.inv.result}`);
    if (h.efek?.renew) nyalakanSetelahPerpanjang(h.efek.renew);
  }
  return h.inv;
}

// ---------------------------------------------------------------------------
// Penyapu berkala (menutup yang hangus, menangkap pembayaran tanpa webhook)
// ---------------------------------------------------------------------------

let sedangSapu = false;
export async function sapuInvoice() {
  if (sedangSapu) return;
  sedangSapu = true;
  try {
    const now = Date.now();
    const hangus = db.prepare("SELECT * FROM invoices WHERE status = 'pending' AND expires_at <= ?").all(now);
    for (const row of hangus) {
      await tutupInvoice(row, 'expired').catch((e) => console.error('[sapu] tutup', row.order_id, e.message));
    }
    const hidup = db
      .prepare("SELECT * FROM invoices WHERE status = 'pending' AND expires_at > ? AND (checked_at IS NULL OR checked_at < ?)")
      .all(now, now - 30_000);
    for (const row of hidup) {
      await cekDanProses(row, { sumber: 'sapu' }).catch((e) => console.error('[sapu] cek', row.order_id, e.message));
    }
    const recheck = db
      .prepare(
        `SELECT * FROM invoices WHERE status IN ('expired','cancelled') AND recheck = 1
         AND closed_at > ? AND (checked_at IS NULL OR checked_at < ?)`,
      )
      .all(now - RECHECK_JENDELA_MS, now - 60_000);
    for (const row of recheck) {
      await cekDanProses(row, { paksa: true, sumber: 'sapu-recheck' }).catch((e) => console.error('[sapu] recheck', row.order_id, e.message));
    }
  } finally {
    sedangSapu = false;
  }
}

export function mulaiSapu() {
  setInterval(() => void sapuInvoice(), SAPU_JEDA_MS).unref();
  void sapuInvoice();
}

// ---------------------------------------------------------------------------
// Bentuk JSON
// ---------------------------------------------------------------------------

const qrCache = new Map(); // order_id -> dataUrl

function labelInvoice(inv, tujuan) {
  if (inv.kind === 'topup') return 'Top up saldo';
  const p = tujuan.paket ?? {};
  if (inv.kind === 'buy') return `Beli server "${tujuan.name || 'baru'}" — paket ${p.name} (${p.days} hari)`;
  return `Perpanjang "${tujuan.serverName || 'server'}" — paket ${p.name} (${p.days} hari)`;
}

async function dataUrlQr(inv) {
  if (!inv.qr_string) return '';
  if (qrCache.has(inv.order_id)) return qrCache.get(inv.order_id);
  try {
    const url = await QRCode.toDataURL(inv.qr_string, { margin: 1, width: 320, errorCorrectionLevel: 'M' });
    qrCache.set(inv.order_id, url);
    return url;
  } catch {
    return '';
  }
}

/** Bentuk invoice untuk pengguna. denganQr=true menyertakan QR (hanya saat pending & belum lewat). */
export async function bentukInvoice(inv, { denganQr = false } = {}) {
  const tujuan = JSON.parse(inv.purpose || '{}');
  const now = Date.now();
  const hidup = inv.status === 'pending' && inv.expires_at > now;

  let qr = null;
  if (denganQr && hidup) {
    qr = {
      string: inv.qr_string,
      url: inv.qr_url || '',
      dataUrl: await dataUrlQr(inv),
      checkoutUrl: inv.checkout_url || '',
    };
  } else if (inv.status !== 'pending') {
    qrCache.delete(inv.order_id);
  }

  return {
    orderId: inv.order_id,
    kind: inv.kind,
    label: labelInvoice(inv, tujuan),
    purpose: tujuan,
    subtotal: inv.subtotal,
    fee: inv.fee,
    amount: inv.amount,
    status: inv.status,
    result: inv.result,
    resultNote: inv.result_note,
    serverId: inv.server_id,
    qr,
    expiresAt: inv.expires_at,
    createdAt: inv.created_at,
    completedAt: inv.completed_at,
    now,
  };
}

/** Bentuk invoice untuk admin (tanpa QR, dengan data internal). */
export function bentukInvoiceAdmin(inv) {
  const u = db.prepare('SELECT id, name, email FROM users WHERE id = ?').get(inv.user_id);
  const tujuan = JSON.parse(inv.purpose || '{}');
  return {
    id: inv.id,
    orderId: inv.order_id,
    kind: inv.kind,
    label: labelInvoice(inv, tujuan),
    user: u ? { id: u.id, name: u.name, email: u.email } : null,
    subtotal: inv.subtotal,
    fee: inv.fee,
    amount: inv.amount,
    status: inv.status,
    result: inv.result,
    resultNote: inv.result_note,
    note: inv.note,
    handledAt: inv.handled_at,
    recheck: inv.recheck,
    gateway: inv.gateway,
    gatewayTrxId: inv.gateway_trx_id,
    gatewayOrderId: inv.gateway_order_id,
    gatewayStatus: inv.gateway_status,
    webhookCount: inv.webhook_count,
    lastWebhookAt: inv.last_webhook_at,
    checkedAt: inv.checked_at,
    paidAt: inv.paid_at,
    closedAt: inv.closed_at,
    completedAt: inv.completed_at,
    createdAt: inv.created_at,
    expiresAt: inv.expires_at,
  };
}

// ---------------------------------------------------------------------------
// Webhook
// ---------------------------------------------------------------------------

export async function webhookPembayaran(req, res) {
  const mentah = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
  if (!verifikasiSignature(mentah, req.get('x-signature'))) {
    console.warn(`[webhook] signature tidak valid dari ${req.ip}`);
    return res.status(401).json({ success: false });
  }
  let body;
  try {
    body = JSON.parse(mentah.toString('utf8'));
  } catch {
    return res.status(400).json({ success: false });
  }
  const trx = body?.transaction;
  if (!trx || typeof trx !== 'object' || (!trx.transaction_id && !trx.order_id)) {
    return res.status(400).json({ success: false });
  }
  try {
    const { http, out } = await prosesNotifikasi(trx);
    return res.status(http).json(out);
  } catch (e) {
    console.error('[webhook] error', e);
    return res.status(500).json({ success: false });
  }
}

async function prosesNotifikasi(trx) {
  let inv =
    (trx.transaction_id && db.prepare('SELECT * FROM invoices WHERE gateway_trx_id = ?').get(trx.transaction_id)) ||
    (trx.order_id && db.prepare('SELECT * FROM invoices WHERE gateway_order_id = ?').get(trx.order_id)) ||
    (trx.order_id && ambilByOrder(trx.order_id));
  if (!inv) {
    console.warn('[webhook] invoice tidak dikenal:', trx.order_id ?? trx.transaction_id);
    return { http: 404, out: { success: false } };
  }
  db.prepare('UPDATE invoices SET webhook_count = webhook_count + 1, last_webhook_at = ? WHERE id = ?').run(Date.now(), inv.id);

  return denganKunci(inv.order_id, async () => {
    inv = ambil(inv.id);
    if (Number(trx.amount) !== inv.amount) {
      db.prepare('UPDATE invoices SET note = ? WHERE id = ?').run(`Webhook: nominal Rp${trx.amount} ≠ tagihan Rp${inv.amount}`, inv.id);
      console.warn(`[webhook] ${inv.order_id} nominal tidak cocok`);
      return { http: 400, out: { success: false } };
    }
    if (inv.status === 'completed') return { http: 200, out: { success: true } };

    const lunasKlaim = ['PAID', 'SETTLEMENT', 'SUCCESS'].includes(String(trx.status).toUpperCase());
    if (!lunasKlaim) {
      db.prepare('UPDATE invoices SET gateway_status = ? WHERE id = ?').run(String(trx.status ?? '').slice(0, 40), inv.id);
      return { http: 200, out: { success: true } };
    }

    const g = await cekStatusQris(inv.gateway_trx_id);
    db.prepare('UPDATE invoices SET checked_at = ?, gateway_status = ? WHERE id = ?').run(
      Date.now(),
      g.status === 'unknown' ? 'error' : g.mentah,
      inv.id,
    );
    if (g.status === 'completed' && (g.amount === null || g.amount === inv.amount)) {
      selesaikanInvoice(inv.id, { paidAt: Date.parse(trx.paid_at) || Date.now(), sumber: 'webhook' });
      return { http: 200, out: { success: true } };
    }
    if (g.status === 'unknown') {
      db.prepare('UPDATE invoices SET recheck = 1 WHERE id = ?').run(inv.id);
      return { http: 503, out: { success: false } };
    }
    db.prepare('UPDATE invoices SET recheck = 1, note = ? WHERE id = ?').run('Webhook PAID tapi gateway belum settlement', inv.id);
    return { http: 202, out: { success: false } };
  });
}

/** (Simulasi) bayar tagihan, lalu jalankan jalur webhook yang sama tanpa signature. */
export async function simulasiBayarInvoice(inv) {
  simulasiBayar(inv.gateway_trx_id);
  await prosesNotifikasi({
    transaction_id: inv.gateway_trx_id,
    order_id: inv.gateway_order_id,
    amount: inv.amount,
    status: 'PAID',
  });
  return ambil(inv.id);
}

import crypto from 'crypto';
import { env } from './env.js';

/*
 Klien gateway pembayaran AutoGopay (QRIS).

 Fungsi murni, tanpa sentuh database. Berdasarkan lib/payment.js milik varesa.mom,
 dengan nama Indonesia. API key HANYA dari environment (env.autogopay.apiKey) —
 tidak pernah ditulis di kode, tidak pernah ikut di pesan error atau log.

 Mode simulasi (AUTOGOPAY_SIMULASI=1 tanpa API key): gateway palsu di memori,
 untuk mencoba alur pembayaran tanpa akun gateway sungguhan.
*/

const { apiKey, baseUrl, simulasi } = env.autogopay;

export class GatewayError extends Error {
  constructor(message) {
    super(message);
    this.name = 'GatewayError';
    this.status = 502;
  }
}

/** QRIS aktif kalau ada API key, atau sedang mode simulasi. */
export function qrisAktif() {
  return Boolean(apiKey) || simulasi;
}

/** Sedang pakai gateway palsu? (simulasi aktif DAN tidak ada API key sungguhan) */
export function modeSimulasi() {
  return simulasi && !apiKey;
}

/** Status mentah gateway -> status internal kita. */
export function petakanStatus(s) {
  switch (String(s ?? '').toLowerCase()) {
    case 'settlement':
    case 'paid':
    case 'success':
      return 'completed';
    case 'expire':
    case 'expired':
      return 'expired';
    case 'cancel':
    case 'cancelled':
      return 'cancelled';
    case 'pending':
      return 'pending';
    default:
      return 'unknown';
  }
}

function header() {
  return {
    Authorization: `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
    Accept: 'application/json',
    'User-Agent': 'varesajasher',
  };
}

async function panggilGateway(path, body, timeoutMs) {
  let res;
  try {
    res = await fetch(`${baseUrl}${path}`, {
      method: 'POST',
      headers: header(),
      body: JSON.stringify(body || {}),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    // Jangan pernah sertakan isi error yang bisa membocorkan header/kredensial.
    throw new GatewayError(err?.name === 'TimeoutError' ? 'Gateway tidak menjawab (timeout).' : 'Gateway tidak bisa dihubungi.');
  }

  const mentah = await res.text();
  let data;
  try {
    data = JSON.parse(mentah);
  } catch {
    throw new GatewayError(`Respons gateway tidak valid (${res.status}).`);
  }
  if (!res.ok) {
    throw new GatewayError(data?.message ? `Gateway menolak: ${String(data.message).slice(0, 160)}` : `Gateway menolak (${res.status}).`);
  }
  return data;
}

// ---------------------------------------------------------------------------
// Gateway palsu untuk mode simulasi
// ---------------------------------------------------------------------------

const palsu = new Map(); // trxId -> { status, amount, orderId }
const acak = (n = 10) => crypto.randomBytes(n).toString('hex');

function simBuat(amount) {
  const transactionId = `SIM-${acak()}`;
  const orderId = `SIMORD-${acak(6)}`;
  palsu.set(transactionId, { status: 'pending', amount, orderId });
  return {
    transactionId,
    orderId,
    amount,
    qrString: `SIMULASI|${orderId}|${amount}`,
    qrUrl: '',
    checkoutUrl: '',
    expiryTime: '',
  };
}

/** (Simulasi) tandai transaksi sudah dibayar. Dipanggil endpoint simulasi-bayar. */
export function simulasiBayar(trxId) {
  const t = palsu.get(trxId);
  if (t && t.status === 'pending') t.status = 'settlement';
  return Boolean(t);
}

// ---------------------------------------------------------------------------
// API publik
// ---------------------------------------------------------------------------

/** Buat QRIS baru. Mengembalikan deskriptor transaksi, atau melempar GatewayError. */
export async function buatQris(amount) {
  if (modeSimulasi()) return simBuat(amount);

  const data = await panggilGateway('/qris/generate', { amount }, 15000);
  const d = data?.data;
  if (!data?.success || !d?.qr_string) {
    throw new GatewayError(data?.message ? String(data.message).slice(0, 160) : 'Gateway tidak mengembalikan QR.');
  }
  return {
    transactionId: d.transaction_id,
    orderId: d.order_id,
    amount: Number(d.amount),
    qrString: d.qr_string,
    qrUrl: d.qr_url || '',
    checkoutUrl: d.checkout_url || '',
    expiryTime: d.expiry_time || '',
  };
}

/** Cek status transaksi. status: pending | completed | expired | cancelled | unknown. */
export async function cekStatusQris(trxId) {
  if (modeSimulasi()) {
    const t = palsu.get(trxId);
    return { status: petakanStatus(t?.status), mentah: t?.status ?? '', amount: t ? Number(t.amount) : null };
  }
  try {
    const data = await panggilGateway('/qris/status', { transaction_id: trxId }, 10000);
    const d = data?.data ?? {};
    const amt = Number(d.amount ?? d.gross_amount);
    return {
      status: petakanStatus(d.transaction_status),
      mentah: String(d.transaction_status ?? ''),
      amount: Number.isFinite(amt) ? amt : null,
    };
  } catch {
    // Gagal cek TIDAK PERNAH dianggap lunas.
    return { status: 'unknown', mentah: '', amount: null };
  }
}

/** Batalkan transaksi di gateway. Tidak pernah melempar. */
export async function batalkanQris(trxId) {
  if (modeSimulasi()) {
    const t = palsu.get(trxId);
    if (!t || t.status === 'settlement') return false;
    t.status = 'cancel';
    return true;
  }
  try {
    const data = await panggilGateway('/qris/cancel', { transaction_id: trxId }, 10000);
    return Boolean(data?.success);
  } catch {
    return false;
  }
}

/** Verifikasi signature webhook: HMAC-SHA256 atas body MENTAH, secret = API key. */
export function verifikasiSignature(rawBuffer, signature) {
  const secret = modeSimulasi() ? 'simulasi' : apiKey;
  if (!secret || !signature) return false;

  const diharap = crypto.createHmac('sha256', secret).update(rawBuffer).digest('hex');
  const a = Buffer.from(String(signature).trim().toLowerCase());
  const b = Buffer.from(diharap);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

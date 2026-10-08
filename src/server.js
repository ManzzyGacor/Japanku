import path from 'path';
import express from 'express';
import { env, ROOT } from './env.js';
import { db } from './db.js';
import { muatPengguna, wajibJson, bersihkanSesiLama } from './auth.js';
import { pasangPerangkat, bersihkanPeristiwa, backfillEmailKanonik } from './antiabuse.js';
import { aktifkanTrialSaatTersambung, mulaiSapuTrial } from './trial.js';
import trialRoutes from './routes/trial.js';
import { manager } from './bot-manager.js';
import { pasangHalaman } from './halaman.js';
import { webhookPembayaran, mulaiSapu } from './pembayaran.js';
import { qrisAktif, modeSimulasi } from './payment.js';
import authRoutes from './routes/auth.js';
import pembayaranRoutes from './routes/pembayaran.js';
import akunRoutes from './routes/akun.js';
import serverRoutes from './routes/servers.js';
import adminRoutes from './routes/admin.js';

const app = express();
const PUBLIC = path.join(ROOT, 'public');

app.disable('x-powered-by');
if (env.trustProxy) app.set('trust proxy', 1);

// Header keamanan dasar. Google Sign-In diizinkan sesuai panduan resminya.
app.use((_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader(
    'Content-Security-Policy',
    [
      "default-src 'self'",
      "script-src 'self' https://accounts.google.com/gsi/client",
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://accounts.google.com/gsi/style",
      "font-src 'self' https://fonts.gstatic.com",
      "img-src 'self' data: https:",
      "connect-src 'self' https://accounts.google.com/gsi/",
      'frame-src https://accounts.google.com/gsi/',
      "object-src 'none'",
      "base-uri 'self'",
      "form-action 'self'",
      "frame-ancestors 'none'",
    ].join('; '),
  );
  next();
});

// Webhook gateway pembayaran: SEBELUM express.json & muatPengguna supaya body
// MENTAH utuh (HMAC dihitung atas byte aslinya), bebas dari wajibJson (CSRF tidak
// berlaku untuk gateway), dan tidak butuh sesi login.
app.post('/api/payment/webhook', express.raw({ type: () => true, limit: '64kb' }), webhookPembayaran);

app.use(express.json({ limit: '100kb' }));
app.use(muatPengguna);

// ---------------------------------------------------------------------------
// API
// ---------------------------------------------------------------------------

const api = express.Router();
api.use(wajibJson);
api.use(pasangPerangkat);
api.use((_req, res, next) => {
  res.setHeader('Cache-Control', 'no-store');
  next();
});
api.use('/auth', authRoutes);
api.use('/payment', pembayaranRoutes);
api.use('/trial', trialRoutes);
api.use('/servers', serverRoutes);
api.use('/admin', adminRoutes);
api.use('/', akunRoutes);
api.use((_req, res) => res.status(404).json({ success: false, message: 'Endpoint tidak ditemukan.' }));

app.use('/api', api);

// ---------------------------------------------------------------------------
// Halaman (URL bersih tanpa .html; lihat src/halaman.js)
// ---------------------------------------------------------------------------

pasangHalaman(app);

// Aset statis (css/js/img). extensions:false supaya *.html tidak dilayani langsung
// — file .html hanya dijangkau lewat path bersih di pasangHalaman().
app.use(express.static(PUBLIC, { index: false, maxAge: '1h' }));

app.use((req, res) => {
  res.status(404).sendFile(path.join(PUBLIC, '404.html'));
});

// Penangan error: pesan rapi untuk kesalahan yang disengaja, catat sisanya
// eslint-disable-next-line no-unused-vars
app.use((error, req, res, _next) => {
  const status = error.status ?? error.statusCode ?? 500;
  if (status >= 500) console.error(`[${req.method} ${req.originalUrl}]`, error);

  const message =
    error.type === 'entity.parse.failed'
      ? 'Format JSON tidak valid.'
      : status >= 500
        ? 'Terjadi kesalahan di server. Coba lagi sebentar.'
        : error.message;
  // `extra` (mis. { code, orderId }) hanya untuk error yang disengaja (< 500).
  res.status(status).json({ success: false, message, ...(status < 500 && error.extra ? error.extra : {}) });
});

// ---------------------------------------------------------------------------
// Mulai
// ---------------------------------------------------------------------------

const server = app.listen(env.port, env.host, () => {
  console.log(`${env.siteName} berjalan di http://${env.host === '0.0.0.0' ? 'localhost' : env.host}:${env.port}`);
  if (env.botSimulasi) console.log('MODE SIMULASI aktif: bot tidak tersambung ke WhatsApp sungguhan.');
  if (!env.adminEmails.length) console.log('Peringatan: ADMIN_EMAILS belum diisi di .env, belum ada akun admin.');

  if (modeSimulasi()) console.log('MODE SIMULASI PEMBAYARAN aktif: QRIS palsu, jangan dipakai untuk produksi.');
  else if (!qrisAktif()) console.log('Info: AUTOGOPAY_API_KEY kosong — pembayaran QRIS otomatis nonaktif, top up manual tetap jalan.');
  else if (!env.baseUrl) console.log('Peringatan: BASE_URL kosong. Daftarkan <BASE_URL>/api/payment/webhook di dashboard AutoGopay.');

  mulaiSapu();

  // Hook pairing untuk ledger nomor & aktivasi trial.
  manager.onPairing = aktifkanTrialSaatTersambung;
  mulaiSapuTrial();

  const jumlah = manager.resumeAll();
  if (jumlah) console.log(`Menyalakan ulang ${jumlah} bot ...`);
});

setInterval(() => manager.cekKedaluwarsa().catch((e) => console.error('Cek kedaluwarsa gagal:', e)), 60 * 1000);
setInterval(bersihkanSesiLama, 60 * 60 * 1000);
setInterval(bersihkanPeristiwa, 6 * 60 * 60 * 1000);
bersihkanSesiLama();
backfillEmailKanonik();

let sedangMati = false;
async function matikan(sinyal) {
  if (sedangMati) return;
  sedangMati = true;
  console.log(`${sinyal} diterima, mematikan semua bot ...`);
  server.close();
  await manager.stopAll();
  db.close();
  process.exit(0);
}

process.on('SIGINT', () => matikan('SIGINT'));
process.on('SIGTERM', () => matikan('SIGTERM'));

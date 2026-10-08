import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Baca file .env sederhana (KEY=nilai). Variabel yang sudah ada di lingkungan tidak ditimpa. */
function muatDotEnv() {
  const file = path.join(ROOT, '.env');
  if (!fs.existsSync(file)) return;

  for (const baris of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const cocok = baris.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!cocok) continue;
    const [, kunci, mentah] = cocok;
    let nilai = mentah.trim();
    if (/^(['"]).*\1$/.test(nilai)) nilai = nilai.slice(1, -1);
    else nilai = nilai.replace(/\s+#.*$/, '');
    if (process.env[kunci] === undefined) process.env[kunci] = nilai;
  }
}

muatDotEnv();

const angka = (nilai, cadangan) => {
  const n = Number(nilai);
  return Number.isFinite(n) && n > 0 ? n : cadangan;
};
const angkaNol = (nilai, cadangan) => {
  const n = Number(nilai);
  return nilai !== undefined && nilai !== '' && Number.isInteger(n) && n >= 0 ? n : cadangan;
};
const ya = (nilai) => ['1', 'true', 'yes', 'ya', 'on'].includes(String(nilai ?? '').toLowerCase());

export const env = {
  siteName: process.env.SITE_NAME || 'VaresaJasher',
  host: process.env.HOST || '0.0.0.0',
  port: angka(process.env.PORT || process.env.SERVER_PORT, 3000),
  baseUrl: (process.env.BASE_URL || '').replace(/\/+$/, ''),
  trustProxy: ya(process.env.TRUST_PROXY),
  cookieSecure: process.env.COOKIE_SECURE === undefined ? null : ya(process.env.COOKIE_SECURE),
  storageDir: path.resolve(ROOT, process.env.STORAGE_DIR || 'storage'),
  adminEmails: (process.env.ADMIN_EMAILS || '')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean),
  googleClientId: process.env.GOOGLE_CLIENT_ID || '',
  botSimulasi: ya(process.env.BOT_SIMULASI),
  botMaxMemoryMb: angka(process.env.BOT_MAX_MEMORY_MB, 300),
  pairingTimeoutMs: angka(process.env.PAIRING_TIMEOUT_MINUTES, 4) * 60 * 1000,
  sessionDays: angka(process.env.SESSION_DAYS, 30),
  github: {
    token: process.env.GITHUB_TOKEN || '',
    username: process.env.GITHUB_USERNAME || '',
    repo: process.env.GITHUB_REPO || '',
    branch: process.env.GITHUB_BRANCH || 'main',
  },
  // Pembayaran QRIS otomatis (AutoGopay). API key hanya dari env, tidak pernah di kode.
  autogopay: {
    apiKey: process.env.AUTOGOPAY_API_KEY || '',
    baseUrl: (process.env.AUTOGOPAY_BASE_URL || 'https://v1-gateway.autogopay.site').replace(/\/+$/, ''),
    simulasi: ya(process.env.AUTOGOPAY_SIMULASI),
  },
  qrisFeeAwal: angkaNol(process.env.QRIS_FEE, 200),
};

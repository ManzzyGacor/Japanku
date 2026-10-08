import crypto from 'crypto';
import { db, semuaPengaturan } from './db.js';
import { env } from './env.js';
import { ipKunci } from './ip.js';
import { gagal } from './util.js';

/*
 Lapisan anti-abuse yang dipakai pendaftaran & klaim trial.

 Prinsip: tiap kontrol itu gerbang keras (identitas yang mahal/susah dipalsukan)
 atau sinyal lunak (murah diganti, sering dibagi pengguna sah). IP = sinyal
 lunak (CGNAT). Gerbang keras trial = NOMOR WhatsApp (lihat trial.js/nomor.js).
*/

const COOKIE_PERANGKAT = 'vj_perangkat';

function bacaCookie(req, nama) {
  for (const bagian of (req.headers.cookie ?? '').split(';')) {
    const [k, ...sisa] = bagian.trim().split('=');
    if (k === nama) return decodeURIComponent(sisa.join('='));
  }
  return null;
}

/** Middleware: pastikan tiap pengunjung punya token perangkat (cookie + diisi ke req.perangkat). */
export function pasangPerangkat(req, res, next) {
  let id = bacaCookie(req, COOKIE_PERANGKAT);
  if (!id || !/^[A-Za-z0-9_-]{16,64}$/.test(id)) {
    id = crypto.randomBytes(18).toString('base64url');
    res.cookie(COOKIE_PERANGKAT, id, {
      httpOnly: true,
      sameSite: 'lax',
      secure: env.cookieSecure ?? req.secure,
      maxAge: 400 * 24 * 60 * 60 * 1000,
      path: '/',
    });
  }
  req.perangkat = id;
  next();
}

/** Email kanonik untuk cek keunikan/abuse (bukan untuk login). Strip titik & +tag pada Gmail dkk. */
export function emailKanonik(email) {
  const e = String(email || '').trim().toLowerCase();
  const at = e.lastIndexOf('@');
  if (at < 0) return e;
  let lokal = e.slice(0, at);
  const domain = e.slice(at + 1);
  const subaddr = new Set(['gmail.com', 'googlemail.com', 'outlook.com', 'hotmail.com', 'live.com', 'icloud.com', 'proton.me', 'protonmail.com']);
  if (subaddr.has(domain)) {
    lokal = lokal.split('+')[0];
    if (domain === 'gmail.com' || domain === 'googlemail.com') lokal = lokal.replace(/\./g, '');
  }
  const domainNorm = domain === 'googlemail.com' ? 'gmail.com' : domain;
  return `${lokal}@${domainNorm}`;
}

// ---------------------------------------------------------------------------
// Peristiwa keamanan (persisten) untuk pembatas yang tahan restart
// ---------------------------------------------------------------------------

export function catatPeristiwa(jenis, kunci) {
  db.prepare('INSERT INTO security_events (kunci, jenis, at) VALUES (?, ?, ?)').run(String(kunci), jenis, Date.now());
}

export function hitungPeristiwa(jenis, kunci, sejakMs) {
  return db
    .prepare('SELECT COUNT(*) AS n FROM security_events WHERE jenis = ? AND kunci = ? AND at >= ?')
    .get(jenis, String(kunci), Date.now() - sejakMs).n;
}

/** Bersihkan peristiwa lama (dipanggil berkala). */
export function bersihkanPeristiwa() {
  db.prepare('DELETE FROM security_events WHERE at < ?').run(Date.now() - 31 * 24 * 60 * 60 * 1000);
}

/** Isi email_canonical untuk akun lama yang belum punya (dipanggil sekali saat start). */
export function backfillEmailKanonik() {
  const kosong = db.prepare("SELECT id, email FROM users WHERE email_canonical = ''").all();
  const simpan = db.prepare('UPDATE users SET email_canonical = ? WHERE id = ?');
  const tx = db.transaction(() => {
    for (const u of kosong) simpan.run(emailKanonik(u.email), u.id);
  });
  tx();
  return kosong.length;
}

const HARI = 24 * 60 * 60 * 1000;

/**
 * Batas pendaftaran per IP (persisten). Dicatat sebagai peristiwa 'daftar'.
 * Dipanggil SEBELUM membuat akun; catat SETELAH akun dibuat.
 */
export function cekBatasDaftar(req) {
  const kunci = ipKunci(req);
  if (!kunci) return; // IP tak dikenal (dev): jangan blokir
  const maks = Number(semuaPengaturan().reg_max_per_ip_day) || 5;
  if (hitungPeristiwa('daftar', kunci, HARI) >= maks) {
    gagal(429, 'Terlalu banyak pendaftaran dari jaringan ini hari ini. Coba lagi besok atau pakai jaringan lain.');
  }
}

export function catatDaftar(req) {
  const kunci = ipKunci(req);
  if (kunci) catatPeristiwa('daftar', kunci);
}

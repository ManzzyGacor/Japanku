import crypto from 'crypto';
import { promisify } from 'util';
import { db } from './db.js';
import { env } from './env.js';

const scrypt = promisify(crypto.scrypt);
const COOKIE = 'vj_session';
const PANJANG_KUNCI = 64;

// ---------------------------------------------------------------------------
// Kata sandi (scrypt bawaan Node, tanpa paket tambahan)
// ---------------------------------------------------------------------------

export async function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = await scrypt(password, salt, PANJANG_KUNCI);
  return `scrypt$${salt.toString('base64')}$${hash.toString('base64')}`;
}

export async function verifyPassword(password, tersimpan) {
  if (!tersimpan?.startsWith('scrypt$')) return false;
  const [, saltB64, hashB64] = tersimpan.split('$');
  const harapan = Buffer.from(hashB64, 'base64');
  const hasil = await scrypt(password, Buffer.from(saltB64, 'base64'), harapan.length);
  return crypto.timingSafeEqual(hasil, harapan);
}

// ---------------------------------------------------------------------------
// Sesi login (token acak di cookie, yang disimpan di database hanya hash-nya)
// ---------------------------------------------------------------------------

const sha256 = (teks) => crypto.createHash('sha256').update(teks).digest('hex');

function bacaCookie(req, nama) {
  for (const bagian of (req.headers.cookie ?? '').split(';')) {
    const [kunci, ...sisa] = bagian.trim().split('=');
    if (kunci === nama) return decodeURIComponent(sisa.join('='));
  }
  return null;
}

function cookieAman(req) {
  return env.cookieSecure ?? req.secure;
}

export function buatSesi(req, res, userId) {
  const token = crypto.randomBytes(32).toString('base64url');
  const sekarang = Date.now();
  const kedaluwarsa = sekarang + env.sessionDays * 24 * 60 * 60 * 1000;

  db.prepare(
    'INSERT INTO sessions (id, user_id, created_at, expires_at, ip, user_agent) VALUES (?, ?, ?, ?, ?, ?)',
  ).run(sha256(token), userId, sekarang, kedaluwarsa, req.ip ?? '', String(req.headers['user-agent'] ?? '').slice(0, 300));

  res.cookie(COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: cookieAman(req),
    expires: new Date(kedaluwarsa),
    path: '/',
  });
}

export function hapusSesi(req, res) {
  const token = bacaCookie(req, COOKIE);
  if (token) db.prepare('DELETE FROM sessions WHERE id = ?').run(sha256(token));
  res.clearCookie(COOKIE, { path: '/', httpOnly: true, sameSite: 'lax', secure: cookieAman(req) });
}

/** Bersihkan sesi yang sudah kedaluwarsa (dipanggil berkala) */
export function bersihkanSesiLama() {
  db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(Date.now());
}

export function isAdmin(user) {
  return user?.role === 'admin' || env.adminEmails.includes(String(user?.email ?? '').toLowerCase());
}

/** Bentuk data pengguna yang aman dikirim ke browser */
export function publicUser(user) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    balance: user.balance,
    isAdmin: isAdmin(user),
    hasPassword: Boolean(user.password_hash),
    createdAt: user.created_at,
  };
}

/** Middleware: isi req.user kalau cookie sesi valid */
export function muatPengguna(req, _res, next) {
  const token = bacaCookie(req, COOKIE);
  if (!token) return next();

  const idSesi = sha256(token);
  const baris = db
    .prepare(
      `SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id
       WHERE s.id = ? AND s.expires_at > ?`,
    )
    .get(idSesi, Date.now());

  if (baris && !baris.banned) {
    req.user = baris;
    req.sessionId = idSesi;
  }
  next();
}

export function wajibLogin(req, res, next) {
  if (!req.user) return res.status(401).json({ success: false, message: 'Silakan masuk terlebih dahulu.' });
  next();
}

export function wajibAdmin(req, res, next) {
  if (!req.user) return res.status(401).json({ success: false, message: 'Silakan masuk terlebih dahulu.' });
  if (!isAdmin(req.user)) return res.status(403).json({ success: false, message: 'Khusus admin.' });
  next();
}

// ---------------------------------------------------------------------------
// Perlindungan dasar
// ---------------------------------------------------------------------------

/**
 * Perlindungan CSRF: permintaan yang mengubah data WAJIB berformat JSON.
 * Form dari situs lain tidak bisa mengirim Content-Type application/json tanpa
 * izin CORS (yang tidak kita berikan), dan cookie sesi juga sudah SameSite=Lax.
 * Cara ini tetap jalan di belakang reverse proxy tanpa pengaturan tambahan.
 */
export function wajibJson(req, res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  if (req.is('application/json')) return next();
  return res.status(415).json({ success: false, message: 'Permintaan harus berformat JSON.' });
}

/** Pembatas sederhana di memori: maksimal `batas` percobaan per `jendelaMs` untuk tiap kunci */
export function pembatas({ batas, jendelaMs, kunci }) {
  const catatan = new Map();

  setInterval(() => {
    const sekarang = Date.now();
    for (const [k, daftar] of catatan) {
      const sisa = daftar.filter((t) => sekarang - t < jendelaMs);
      if (sisa.length) catatan.set(k, sisa);
      else catatan.delete(k);
    }
  }, jendelaMs).unref();

  return (req, res, next) => {
    const k = kunci(req);
    const sekarang = Date.now();
    const daftar = (catatan.get(k) ?? []).filter((t) => sekarang - t < jendelaMs);

    if (daftar.length >= batas) {
      const tunggu = Math.ceil((jendelaMs - (sekarang - daftar[0])) / 1000);
      return res.status(429).json({ success: false, message: `Terlalu banyak percobaan. Coba lagi dalam ${tunggu} detik.` });
    }

    daftar.push(sekarang);
    catatan.set(k, daftar);
    next();
  };
}

/** Verifikasi ID token dari tombol "Masuk dengan Google" */
export async function verifikasiTokenGoogle(credential) {
  if (!env.googleClientId) throw Object.assign(new Error('Login Google belum diaktifkan.'), { status: 400 });

  const respons = await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(credential)}`);
  if (!respons.ok) throw Object.assign(new Error('Token Google tidak valid.'), { status: 401 });

  const data = await respons.json();
  const terverifikasi = data.email_verified === true || data.email_verified === 'true';

  if (data.aud !== env.googleClientId || !terverifikasi || !data.email || !data.sub) {
    throw Object.assign(new Error('Token Google tidak valid.'), { status: 401 });
  }
  if (Number(data.exp) * 1000 < Date.now()) {
    throw Object.assign(new Error('Token Google sudah kedaluwarsa.'), { status: 401 });
  }

  return { sub: data.sub, email: data.email, name: data.name || data.email.split('@')[0] };
}

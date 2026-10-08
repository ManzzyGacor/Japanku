import { Router } from 'express';
import { db } from '../db.js';
import { env } from '../env.js';
import {
  hashPassword,
  verifyPassword,
  buatSesi,
  hapusSesi,
  publicUser,
  pembatas,
  verifikasiTokenGoogle,
} from '../auth.js';
import { emailKanonik, cekBatasDaftar, catatDaftar } from '../antiabuse.js';
import { ipKunci } from '../ip.js';
import { gagal, teks, email as cekEmail } from '../util.js';

const router = Router();

const batasLogin = pembatas({
  batas: 10,
  jendelaMs: 15 * 60 * 1000,
  kunci: (req) => `${ipKunci(req) || `dev:${req.perangkat}`}|${String(req.body?.email ?? '').toLowerCase()}`,
});
// Pembatas memori per jam (burst), di atas batas harian persisten di cekBatasDaftar.
const batasDaftar = pembatas({ batas: 8, jendelaMs: 60 * 60 * 1000, kunci: (req) => ipKunci(req) || `dev:${req.perangkat}` });

function buatAkun(req, { name, email, passwordHash = null, googleSub = null }) {
  const sekarang = Date.now();
  // Peran admin TIDAK diberikan di sini walau email ada di ADMIN_EMAILS — isAdmin()
  // baru mengakuinya setelah email terverifikasi (lewat Google). CLI bisa memberi
  // role 'admin' secara eksplisit.
  const hasil = db
    .prepare(
      `INSERT INTO users (name, email, email_canonical, password_hash, google_sub, role,
         email_verified_at, signup_ip, signup_device, created_at)
       VALUES (?, ?, ?, ?, ?, 'user', ?, ?, ?, ?)`,
    )
    .run(
      name,
      email,
      emailKanonik(email),
      passwordHash,
      googleSub,
      googleSub ? sekarang : null, // akun Google = email terverifikasi
      ipKunci(req) || '',
      req.perangkat || '',
      sekarang,
    );
  return db.prepare('SELECT * FROM users WHERE id = ?').get(hasil.lastInsertRowid);
}

/** Pengaturan yang dibutuhkan halaman login (tanpa rahasia apa pun) */
router.get('/config', (_req, res) => {
  res.json({ success: true, siteName: env.siteName, googleClientId: env.googleClientId || null });
});

router.post('/register', batasDaftar, async (req, res) => {
  const name = teks(req.body?.name, { nama: 'Nama', min: 2, max: 60 });
  const email = cekEmail(req.body?.email);
  const password = teks(req.body?.password, { nama: 'Kata sandi', min: 8, max: 200 });

  if (db.prepare('SELECT id FROM users WHERE email = ?').get(email)) {
    gagal(409, 'Email sudah terdaftar. Silakan masuk.');
  }
  cekBatasDaftar(req);

  const user = buatAkun(req, { name, email, passwordHash: await hashPassword(password) });
  catatDaftar(req);
  buatSesi(req, res, user.id);
  res.status(201).json({ success: true, user: publicUser(user) });
});

router.post('/login', batasLogin, async (req, res) => {
  const email = cekEmail(req.body?.email);
  const password = teks(req.body?.password, { nama: 'Kata sandi', max: 200 });

  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
  const cocok = user?.password_hash ? await verifyPassword(password, user.password_hash) : false;

  if (!cocok) {
    if (user && !user.password_hash) gagal(401, 'Akun ini dibuat lewat Google. Silakan masuk dengan Google.');
    gagal(401, 'Email atau kata sandi salah.');
  }
  if (user.banned) gagal(403, 'Akun kamu dinonaktifkan. Hubungi admin.');

  buatSesi(req, res, user.id);
  res.json({ success: true, user: publicUser(user) });
});

router.post('/google', batasLogin, async (req, res) => {
  const profil = await verifikasiTokenGoogle(teks(req.body?.credential, { nama: 'Token', max: 5000 }));
  const email = profil.email.toLowerCase();

  let user = db.prepare('SELECT * FROM users WHERE google_sub = ?').get(profil.sub);
  let sandiDihapus = false;

  if (!user) {
    const byEmail = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
    if (!byEmail) {
      cekBatasDaftar(req);
      user = buatAkun(req, { name: (profil.name || email.split('@')[0]).slice(0, 60), email, googleSub: profil.sub });
      catatDaftar(req);
    } else if (byEmail.google_sub && byEmail.google_sub !== profil.sub) {
      // Email yang sama sudah tertaut ke akun Google lain — jangan ambil alih.
      gagal(409, 'Email ini sudah tertaut ke akun Google lain.');
    } else {
      // Email cocok tapi belum tertaut. Google membuktikan kepemilikan email, jadi
      // identitas Google-lah pemiliknya. Kalau akun ini punya sandi tapi belum
      // terverifikasi, HAPUS sandi + semua sesi (anti-ambil-alih) lalu verifikasi.
      sandiDihapus = Boolean(byEmail.password_hash) && !byEmail.email_verified_at;
      db.prepare(
        `UPDATE users SET google_sub = ?, email_verified_at = COALESCE(email_verified_at, ?),
           password_hash = CASE WHEN email_verified_at IS NULL THEN NULL ELSE password_hash END
         WHERE id = ?`,
      ).run(profil.sub, Date.now(), byEmail.id);
      if (sandiDihapus) db.prepare('DELETE FROM sessions WHERE user_id = ?').run(byEmail.id);
      user = db.prepare('SELECT * FROM users WHERE id = ?').get(byEmail.id);
    }
  }
  if (user.banned) gagal(403, 'Akun kamu dinonaktifkan. Hubungi admin.');

  buatSesi(req, res, user.id);
  res.json({
    success: true,
    user: publicUser(user),
    ...(sandiDihapus ? { message: 'Demi keamanan, kata sandi lama dihapus. Buat sandi baru di halaman Akun kalau mau masuk lewat email.' } : {}),
  });
});

router.post('/logout', (req, res) => {
  hapusSesi(req, res);
  res.json({ success: true });
});

/** Pengguna yang sedang masuk, atau user: null kalau belum masuk */
router.get('/me', (req, res) => {
  res.json({ success: true, user: req.user ? publicUser(req.user) : null });
});

export default router;

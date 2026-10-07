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
import { gagal, teks, email as cekEmail } from '../util.js';

const router = Router();

const batasLogin = pembatas({
  batas: 10,
  jendelaMs: 15 * 60 * 1000,
  kunci: (req) => `${req.ip}|${String(req.body?.email ?? '').toLowerCase()}`,
});
const batasDaftar = pembatas({ batas: 5, jendelaMs: 60 * 60 * 1000, kunci: (req) => req.ip });

function buatAkun({ name, email, passwordHash = null, googleSub = null }) {
  const role = env.adminEmails.includes(email) ? 'admin' : 'user';
  const hasil = db
    .prepare(
      'INSERT INTO users (name, email, password_hash, google_sub, role, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    )
    .run(name, email, passwordHash, googleSub, role, Date.now());
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

  const user = buatAkun({ name, email, passwordHash: await hashPassword(password) });
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

  let user =
    db.prepare('SELECT * FROM users WHERE google_sub = ?').get(profil.sub) ??
    db.prepare('SELECT * FROM users WHERE email = ?').get(email);

  if (!user) {
    user = buatAkun({ name: profil.name.slice(0, 60), email, googleSub: profil.sub });
  } else if (!user.google_sub) {
    db.prepare('UPDATE users SET google_sub = ? WHERE id = ?').run(profil.sub, user.id);
  }
  if (user.banned) gagal(403, 'Akun kamu dinonaktifkan. Hubungi admin.');

  buatSesi(req, res, user.id);
  res.json({ success: true, user: publicUser(user) });
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

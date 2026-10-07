/*
 Alat admin dari terminal (tanpa perlu menyalakan server web).

   npm run admin -- jadikan-admin email@kamu.com   jadikan akun ini admin
   npm run admin -- cabut-admin email@kamu.com     cabut akses admin
   npm run admin -- saldo email@kamu.com 50000     tambah saldo (angka negatif = kurangi)
   npm run admin -- sandi email@kamu.com SandiBaru123   atur ulang kata sandi
   npm run admin -- daftar                          daftar 50 akun terbaru
*/
import { db, ubahSaldo } from '../src/db.js';
import { hashPassword } from '../src/auth.js';

const [perintah, email, nilai] = process.argv.slice(2);

function cariUser() {
  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(String(email ?? '').toLowerCase());
  if (!user) {
    console.error(`Akun dengan email "${email}" tidak ditemukan. Daftar dulu lewat website.`);
    process.exit(1);
  }
  return user;
}

switch (perintah) {
  case 'jadikan-admin':
  case 'cabut-admin': {
    const user = cariUser();
    const role = perintah === 'jadikan-admin' ? 'admin' : 'user';
    db.prepare('UPDATE users SET role = ? WHERE id = ?').run(role, user.id);
    console.log(`${user.email} sekarang ${role === 'admin' ? 'ADMIN' : 'pengguna biasa'}.`);
    break;
  }
  case 'saldo': {
    const user = cariUser();
    const jumlah = Number(nilai);
    if (!Number.isInteger(jumlah) || jumlah === 0) {
      console.error('Nominal harus angka bulat dan bukan 0, contoh: 50000 atau -5000');
      process.exit(1);
    }
    const saldo = db.transaction(() => ubahSaldo(user.id, jumlah, 'adjust', 'Penyesuaian saldo lewat terminal'))();
    console.log(`Saldo ${user.email} sekarang Rp${saldo.toLocaleString('id-ID')}.`);
    break;
  }
  case 'sandi': {
    const user = cariUser();
    if (!nilai || nilai.length < 8) {
      console.error('Kata sandi baru minimal 8 karakter.');
      process.exit(1);
    }
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(await hashPassword(nilai), user.id);
    db.prepare('DELETE FROM sessions WHERE user_id = ?').run(user.id);
    console.log(`Kata sandi ${user.email} sudah diganti. Semua sesi login akun ini dikeluarkan.`);
    break;
  }
  case 'daftar': {
    const daftar = db.prepare('SELECT id, name, email, role, balance, banned FROM users ORDER BY id DESC LIMIT 50').all();
    console.table(daftar);
    break;
  }
  default:
    console.log(`Pemakaian:
  npm run admin -- jadikan-admin email@kamu.com
  npm run admin -- cabut-admin email@kamu.com
  npm run admin -- saldo email@kamu.com 50000
  npm run admin -- sandi email@kamu.com SandiBaru123
  npm run admin -- daftar`);
}

db.close();

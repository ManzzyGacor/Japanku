import fs from 'fs';
import path from 'path';
import Database from 'better-sqlite3';
import { env } from './env.js';

fs.mkdirSync(env.storageDir, { recursive: true });

export const db = new Database(path.join(env.storageDir, 'varesajasher.sqlite'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
db.pragma('busy_timeout = 5000');

/**
 * Skema database. Tiap elemen = satu versi migrasi; jangan ubah yang sudah ada,
 * tambahkan elemen baru di akhir untuk perubahan berikutnya.
 */
const MIGRASI = [
  `
  CREATE TABLE users (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    name          TEXT    NOT NULL,
    email         TEXT    NOT NULL UNIQUE COLLATE NOCASE,
    password_hash TEXT,
    google_sub    TEXT    UNIQUE,
    role          TEXT    NOT NULL DEFAULT 'user',
    balance       INTEGER NOT NULL DEFAULT 0,
    banned        INTEGER NOT NULL DEFAULT 0,
    created_at    INTEGER NOT NULL
  );

  CREATE TABLE sessions (
    id         TEXT    PRIMARY KEY,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL,
    ip         TEXT,
    user_agent TEXT
  );
  CREATE INDEX idx_sessions_user ON sessions(user_id);

  CREATE TABLE packages (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    name        TEXT    NOT NULL,
    description TEXT    NOT NULL DEFAULT '',
    days        INTEGER NOT NULL,
    price       INTEGER NOT NULL,
    active      INTEGER NOT NULL DEFAULT 1,
    sort        INTEGER NOT NULL DEFAULT 0,
    created_at  INTEGER NOT NULL
  );

  CREATE TABLE servers (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id        INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name           TEXT    NOT NULL,
    package_id     INTEGER REFERENCES packages(id) ON DELETE SET NULL,
    phone          TEXT    UNIQUE,
    enabled        INTEGER NOT NULL DEFAULT 0,
    settings       TEXT    NOT NULL DEFAULT '{}',
    expires_at     INTEGER NOT NULL,
    created_at     INTEGER NOT NULL,
    last_online_at INTEGER
  );
  CREATE INDEX idx_servers_user ON servers(user_id);

  CREATE TABLE transactions (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    type          TEXT    NOT NULL,
    amount        INTEGER NOT NULL,
    balance_after INTEGER NOT NULL,
    description   TEXT    NOT NULL DEFAULT '',
    created_at    INTEGER NOT NULL
  );
  CREATE INDEX idx_transactions_user ON transactions(user_id);

  CREATE TABLE topups (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    amount       INTEGER NOT NULL,
    method       TEXT    NOT NULL DEFAULT '',
    note         TEXT    NOT NULL DEFAULT '',
    status       TEXT    NOT NULL DEFAULT 'pending',
    admin_note   TEXT    NOT NULL DEFAULT '',
    created_at   INTEGER NOT NULL,
    processed_at INTEGER,
    processed_by INTEGER REFERENCES users(id) ON DELETE SET NULL
  );
  CREATE INDEX idx_topups_status ON topups(status);

  CREATE TABLE settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
  `,
  // --- MIGRASI[1]: katalog paket bertingkat (Uji Sinyal / Antena / Menara / Satelit) ---
  // Menambah kolom "kode" (stabil, dipakai API & logika) dan "size_label" (label ukuran).
  // Paket lama (Mingguan/Bulanan/3 Bulan) dinonaktifkan, lalu 3 tier bulanan dimasukkan.
  `
  ALTER TABLE packages ADD COLUMN code TEXT NOT NULL DEFAULT '';
  ALTER TABLE packages ADD COLUMN size_label TEXT NOT NULL DEFAULT '';
  CREATE UNIQUE INDEX idx_packages_code ON packages(code) WHERE code != '';

  UPDATE packages SET active = 0 WHERE code = '';

  INSERT INTO packages (code, name, size_label, description, days, price, active, sort, created_at)
  SELECT 'antena', 'Antena', 'Server Kecil',
         'Buat kamu yang baru mulai jasher. Semua mode JPM, jangkauan sampai 50 grup per putaran.',
         30, 7000, 1, 1, CAST(strftime('%s','now') AS INTEGER) * 1000
  WHERE NOT EXISTS (SELECT 1 FROM packages WHERE code = 'antena');

  INSERT INTO packages (code, name, size_label, description, days, price, active, sort, created_at)
  SELECT 'menara', 'Menara', 'Server Sedang',
         'Untuk seller yang makin serius. Jangkauan sampai 200 grup per putaran dan 10 postingan tersimpan.',
         30, 12000, 1, 2, CAST(strftime('%s','now') AS INTEGER) * 1000
  WHERE NOT EXISTS (SELECT 1 FROM packages WHERE code = 'menara');

  INSERT INTO packages (code, name, size_label, description, days, price, active, sort, created_at)
  SELECT 'satelit', 'Satelit', 'Server Besar',
         'Jangkauan penuh ke semua grup, 2 tugas otomatis sekaligus, dan 30 postingan tersimpan. Paling hemat per grup.',
         30, 15000, 1, 3, CAST(strftime('%s','now') AS INTEGER) * 1000
  WHERE NOT EXISTS (SELECT 1 FROM packages WHERE code = 'satelit');
  `,
  // --- MIGRASI[2]: tagihan pembayaran QRIS otomatis (AutoGopay) ---
  `
  CREATE TABLE invoices (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    order_id         TEXT    NOT NULL UNIQUE,
    user_id          INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    kind             TEXT    NOT NULL CHECK (kind IN ('topup', 'buy', 'renew')),
    purpose          TEXT    NOT NULL DEFAULT '{}',
    server_id        INTEGER REFERENCES servers(id) ON DELETE SET NULL,
    subtotal         INTEGER NOT NULL,
    fee              INTEGER NOT NULL DEFAULT 0,
    amount           INTEGER NOT NULL,
    gateway          TEXT    NOT NULL DEFAULT 'autogopay',
    gateway_trx_id   TEXT    UNIQUE,
    gateway_order_id TEXT    NOT NULL DEFAULT '',
    gateway_status   TEXT    NOT NULL DEFAULT '',
    qr_string        TEXT    NOT NULL DEFAULT '',
    qr_url           TEXT    NOT NULL DEFAULT '',
    checkout_url     TEXT    NOT NULL DEFAULT '',
    status           TEXT    NOT NULL DEFAULT 'pending'
                     CHECK (status IN ('pending', 'completed', 'expired', 'cancelled')),
    result           TEXT    NOT NULL DEFAULT '',
    result_note      TEXT    NOT NULL DEFAULT '',
    note             TEXT    NOT NULL DEFAULT '',
    handled_at       INTEGER,
    recheck          INTEGER NOT NULL DEFAULT 0,
    webhook_count    INTEGER NOT NULL DEFAULT 0,
    last_webhook_at  INTEGER,
    checked_at       INTEGER,
    paid_at          INTEGER,
    expires_at       INTEGER NOT NULL,
    completed_at     INTEGER,
    closed_at        INTEGER,
    created_at       INTEGER NOT NULL
  );
  CREATE INDEX idx_invoices_user   ON invoices(user_id, id);
  CREATE INDEX idx_invoices_status ON invoices(status, expires_at);
  CREATE UNIQUE INDEX idx_invoices_satu_pending ON invoices(user_id) WHERE status = 'pending';
  `,
];

function migrasi() {
  const versi = db.pragma('user_version', { simple: true });
  for (let i = versi; i < MIGRASI.length; i += 1) {
    db.transaction(() => {
      db.exec(MIGRASI[i]);
      db.pragma(`user_version = ${i + 1}`);
    })();
  }
}

/**
 * Paket bawaan saat database masih kosong (fresh install).
 * Tiga tier bulanan: Antena (kecil) / Menara (sedang) / Satelit (besar).
 * Harga & durasi bisa diubah dari panel admin. Untuk DB lama, MIGRASI[1] yang mengisi.
 */
const PAKET_AWAL = [
  {
    code: 'antena',
    name: 'Antena',
    sizeLabel: 'Server Kecil',
    description: 'Buat kamu yang baru mulai jasher. Semua mode JPM, jangkauan sampai 50 grup per putaran.',
    days: 30,
    price: 7000,
  },
  {
    code: 'menara',
    name: 'Menara',
    sizeLabel: 'Server Sedang',
    description: 'Untuk seller yang makin serius. Jangkauan sampai 200 grup per putaran dan 10 postingan tersimpan.',
    days: 30,
    price: 12000,
  },
  {
    code: 'satelit',
    name: 'Satelit',
    sizeLabel: 'Server Besar',
    description:
      'Jangkauan penuh ke semua grup, 2 tugas otomatis sekaligus, dan 30 postingan tersimpan. Paling hemat per grup.',
    days: 30,
    price: 15000,
  },
];

export const PENGATURAN_SITUS_AWAL = {
  payment_instructions:
    'Transfer sesuai nominal ke salah satu rekening / e-wallet di bawah, lalu kirim permintaan top up. Saldo masuk setelah dicek admin.\n\nDANA / OVO / GoPay: 08xxxxxxxxxx a.n. Nama Kamu',
  payment_qris_url: '',
  contact_whatsapp: '',
  min_topup: '5000',
  announcement: '',
  // Pembayaran QRIS otomatis
  qris_fee: String(env.qrisFeeAwal), // biaya admin flat (rupiah), per transaksi QRIS
  qris_min_amount: '1000', // minimal subtotal per QRIS
  manual_topup: '1', // '1' = top up manual tetap ditampilkan walau QRIS aktif
};

function benih() {
  const sekarang = Date.now();

  if (db.prepare('SELECT COUNT(*) AS n FROM packages').get().n === 0) {
    const tambah = db.prepare(
      'INSERT INTO packages (code, name, size_label, description, days, price, sort, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    );
    PAKET_AWAL.forEach((p, i) => tambah.run(p.code, p.name, p.sizeLabel, p.description, p.days, p.price, i + 1, sekarang));
  }

  const isi = db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)');
  for (const [kunci, nilai] of Object.entries(PENGATURAN_SITUS_AWAL)) isi.run(kunci, nilai);
}

migrasi();
benih();

// ---------------------------------------------------------------------------
// Pengaturan situs
// ---------------------------------------------------------------------------

export function semuaPengaturan() {
  const hasil = { ...PENGATURAN_SITUS_AWAL };
  for (const { key, value } of db.prepare('SELECT key, value FROM settings').all()) hasil[key] = value;
  return hasil;
}

export function simpanPengaturan(data) {
  const simpan = db.prepare(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
  );
  db.transaction(() => {
    for (const kunci of Object.keys(PENGATURAN_SITUS_AWAL)) {
      if (data[kunci] !== undefined) simpan.run(kunci, String(data[kunci]));
    }
  })();
}

// ---------------------------------------------------------------------------
// Saldo
// ---------------------------------------------------------------------------

export class SaldoKurang extends Error {
  constructor() {
    super('Saldo tidak cukup.');
    this.status = 400;
  }
}

/**
 * Ubah saldo pengguna dan catat di riwayat transaksi.
 * WAJIB dipanggil di dalam db.transaction() kalau digabung dengan perubahan lain.
 * @returns {number} saldo setelah perubahan
 */
export function ubahSaldo(userId, jumlah, jenis, keterangan) {
  const user = db.prepare('SELECT balance FROM users WHERE id = ?').get(userId);
  if (!user) throw new Error('Pengguna tidak ditemukan.');

  const saldoBaru = user.balance + jumlah;
  if (saldoBaru < 0) throw new SaldoKurang();

  db.prepare('UPDATE users SET balance = ? WHERE id = ?').run(saldoBaru, userId);
  db.prepare(
    'INSERT INTO transactions (user_id, type, amount, balance_after, description, created_at) VALUES (?, ?, ?, ?, ?, ?)',
  ).run(userId, jenis, jumlah, saldoBaru, keterangan, Date.now());

  return saldoBaru;
}

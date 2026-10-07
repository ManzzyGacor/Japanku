import fs from 'fs';
import path from 'path';
import { db, ubahSaldo } from './db.js';
import { manager, folderServer, PENGATURAN_BOT_AWAL } from './bot-manager.js';
import { gagal, HARI_MS } from './util.js';

/*
 Logika beli & perpanjang server dari SALDO, dipakai bersama oleh:
  - routes/servers.js  (bayar langsung dari saldo)
  - pembayaran.js      (setelah QRIS lunas -> saldo bertambah -> beli/perpanjang)
 Perilakunya identik dengan kode lama supaya pesan & ledger tidak berubah.
*/

/** Paket aktif berdasarkan id, atau 400 kalau tidak ada / sudah tidak dijual. */
export function paketAktif(id) {
  const paket = db.prepare('SELECT * FROM packages WHERE id = ? AND active = 1').get(Number(id));
  if (!paket) gagal(400, 'Paket tidak ditemukan atau sudah tidak dijual.');
  return paket;
}

/** Potongan data paket yang dibekukan di invoice (harga tetap walau admin ubah harga). */
export function snapshotPaket(p) {
  return { id: p.id, name: p.name, days: p.days, price: p.price };
}

/**
 * Beli server dari saldo. HARUS dipanggil di dalam db.transaction (atau nested
 * -> SAVEPOINT). Mengembalikan id server baru.
 * @param {number} userId
 * @param {{paket: object, name?: string}} opsi  paket = snapshot {id,name,days,price}
 */
export const beliDariSaldo = db.transaction((userId, { paket, name }) => {
  const jumlah = db.prepare('SELECT COUNT(*) AS n FROM servers WHERE user_id = ?').get(userId).n;
  const nama = (name && String(name).trim()) || `Server ${jumlah + 1}`;
  const sekarang = Date.now();

  ubahSaldo(userId, -paket.price, 'purchase', `Beli server "${nama}" - paket ${paket.name} (${paket.days} hari)`);

  // package_id hanya diisi kalau paketnya masih ada (bisa saja dihapus admin di tengah).
  const paketAda = db.prepare('SELECT 1 FROM packages WHERE id = ?').get(paket.id) ? paket.id : null;

  return db
    .prepare('INSERT INTO servers (user_id, name, package_id, settings, expires_at, created_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run(userId, nama, paketAda, JSON.stringify(PENGATURAN_BOT_AWAL), sekarang + paket.days * HARI_MS, sekarang)
    .lastInsertRowid;
});

/**
 * Perpanjang server dari saldo. HARUS di dalam db.transaction.
 * @param {number} userId
 * @param {object} server  baris server (minimal {id, name, expires_at})
 * @param {{id,name,days,price}} paket  snapshot paket
 */
export const perpanjangDariSaldo = db.transaction((userId, server, paket) => {
  ubahSaldo(userId, -paket.price, 'renew', `Perpanjang "${server.name}" - paket ${paket.name} (${paket.days} hari)`);
  const dasar = Math.max(Date.now(), server.expires_at);
  const paketAda = db.prepare('SELECT 1 FROM packages WHERE id = ?').get(paket.id) ? paket.id : server.package_id;
  db.prepare('UPDATE servers SET expires_at = ?, package_id = ? WHERE id = ?').run(
    dasar + paket.days * HARI_MS,
    paketAda,
    server.id,
  );
});

/**
 * Nyalakan lagi server yang tadinya mati karena kedaluwarsa, setelah diperpanjang.
 * Dipanggil SETELAH transaksi commit, tidak pernah di dalamnya.
 * @param {object} serverSebelum  baris server SEBELUM perpanjang (untuk cek kedaluwarsa)
 */
export function nyalakanSetelahPerpanjang(serverSebelum) {
  const tadinyaKedaluwarsa = serverSebelum.expires_at <= Date.now();
  if (!tadinyaKedaluwarsa) return;

  const terbaru = db.prepare('SELECT * FROM servers WHERE id = ?').get(serverSebelum.id);
  const adaSesi = fs.existsSync(path.join(folderServer(serverSebelum.id), 'sessions'));
  if (terbaru?.phone && adaSesi && !manager.isRunning(serverSebelum.id)) {
    db.prepare('UPDATE servers SET enabled = 1 WHERE id = ?').run(serverSebelum.id);
    manager.start(db.prepare('SELECT * FROM servers WHERE id = ?').get(serverSebelum.id));
  }
}

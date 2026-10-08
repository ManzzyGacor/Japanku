import { db } from './db.js';
import { sidik } from './ip.js';

/*
 Riwayat nomor WhatsApp yang pernah berhasil pairing di situs ini.

 Dicatat pada SETIAP pairing yang berhasil (server trial maupun berbayar), dan
 tidak pernah dihapus. Dipakai untuk aturan "1 free trial per nomor WhatsApp,
 selamanya": nomor yang pernah muncul di sini tidak boleh memulai trial baru.
*/

/** Catat nomor yang baru berhasil pairing. Aman dipanggil berulang. */
export function catatPairing(serverId, phone, identity = '') {
  const nomor = String(phone || '').replace(/\D/g, '');
  if (!nomor) return;
  db.prepare(
    `INSERT INTO nomor_riwayat (phone, identity_hash, first_server, first_seen_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(phone) DO UPDATE SET identity_hash = CASE WHEN nomor_riwayat.identity_hash = '' THEN excluded.identity_hash ELSE nomor_riwayat.identity_hash END`,
  ).run(nomor, identity ? sidik('lid', identity) : '', serverId ?? null, Date.now());
}

/** Nomor ini pernah dipakai pairing di situs ini? */
export function nomorPernahDipakai(phone) {
  const nomor = String(phone || '').replace(/\D/g, '');
  if (!nomor) return false;
  return Boolean(db.prepare('SELECT 1 FROM nomor_riwayat WHERE phone = ?').get(nomor));
}

/** Nomor boleh memulai free trial? (belum pernah dipakai pairing sama sekali) */
export function nomorBolehTrial(phone) {
  return !nomorPernahDipakai(phone);
}

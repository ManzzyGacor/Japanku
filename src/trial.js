import { db, semuaPengaturan } from './db.js';
import { manager, PENGATURAN_BOT_AWAL } from './bot-manager.js';
import { ipKunci, sidik } from './ip.js';
import { emailKanonik } from './antiabuse.js';
import { nomorBolehTrial, catatPairing } from './nomor.js';
import { gagal, HARI_MS } from './util.js';

/*
 Free trial "Uji Sinyal".

 - 1 trial per akun, 1 server, paket terkecil (kode 'uji'), 24 jam.
 - Gerbang keras: 1 trial per NOMOR WhatsApp selamanya (nomor.js). Nomor yang
   pernah dipakai pairing di situs ini tidak bisa memulai trial.
 - Sinyal lunak: batas per IP & per perangkat dalam 30 hari (CGNAT -> tidak
   pernah jadi satu-satunya gerbang).
 - Jam 24 jam dihitung sejak nomor TERSAMBUNG (activated_at), bukan sejak klaim.
*/

const HARI30 = 30 * HARI_MS;

const s = () => semuaPengaturan();

export function trialAktif() {
  return s().trial_enabled === '1';
}

function paketTrial() {
  const p = db.prepare("SELECT * FROM packages WHERE code = 'uji'").get();
  if (!p) throw new Error("Paket trial 'uji' tidak ada.");
  return p;
}

/** Klaim trial milik user saat ini (aktif/pending), atau null. */
export function trialBerjalan(userId) {
  return db
    .prepare("SELECT * FROM trial_claims WHERE user_id = ? AND status IN ('pending_phone','active') ORDER BY id DESC LIMIT 1")
    .get(userId);
}

/** Apakah user boleh klaim trial? Mengembalikan { boleh, alasan }. */
export function statusKelayakan(user) {
  if (!trialAktif()) return { boleh: false, alasan: 'Free trial sedang tidak tersedia.' };
  if (s().trial_requirement === 'google' && !user.email_verified_at) {
    return { boleh: false, alasan: 'Trial perlu login dengan Google dulu.' };
  }
  // 1 trial per akun: pernah punya trial yang aktif/berakhir = tidak bisa lagi.
  const pernah = db
    .prepare("SELECT COUNT(*) AS n FROM trial_claims WHERE user_id = ? AND status IN ('active','ended')")
    .get(user.id).n;
  if (pernah > 0 || trialBerjalan(user.id)) {
    return { boleh: false, alasan: 'Kamu sudah pernah memakai free trial.' };
  }
  return { boleh: true };
}

/**
 * Klaim trial: buat server trial (belum tersambung). Jam baru jalan saat nomor
 * terhubung. Mengembalikan baris server.
 */
export const klaimTrial = db.transaction((req, user) => {
  const kel = statusKelayakan(user);
  if (!kel.boleh) gagal(400, kel.alasan, { code: 'TRIAL_TAK_LAYAK' });

  const pengaturan = s();
  const ipk = ipKunci(req) || '';
  const perangkat = req.perangkat || '';
  const emailK = emailKanonik(user.email);

  // Sinyal lunak: batas per perangkat & per IP dalam 30 hari.
  const maxDevice = Number(pengaturan.trial_max_per_device_30d) || 1;
  const maxIp = Number(pengaturan.trial_max_per_ip_30d) || 2;
  const sejak = Date.now() - HARI30;
  if (perangkat) {
    const n = db.prepare("SELECT COUNT(*) AS n FROM trial_claims WHERE device_id = ? AND status != 'reset' AND created_at >= ?").get(perangkat, sejak).n;
    if (n >= maxDevice) gagal(429, 'Perangkat ini sudah memakai jatah free trial. Pakai paket berbayar, ya.', { code: 'TRIAL_PERANGKAT' });
  }
  if (ipk) {
    const n = db.prepare("SELECT COUNT(*) AS n FROM trial_claims WHERE ip_key = ? AND status != 'reset' AND created_at >= ?").get(ipk, sejak).n;
    if (n >= maxIp) gagal(429, 'Jaringan ini sudah dipakai beberapa kali untuk free trial. Coba lagi nanti atau pakai paket berbayar.', { code: 'TRIAL_IP' });
  }
  // Batas pending se-situs (circuit breaker).
  const pendingMax = Number(pengaturan.trial_pending_max) || 20;
  const pending = db.prepare("SELECT COUNT(*) AS n FROM trial_claims WHERE status = 'pending_phone'").get().n;
  if (pending >= pendingMax) gagal(429, 'Lagi ramai yang coba Uji Sinyal. Coba lagi beberapa menit lagi, ya.', { code: 'TRIAL_RAMAI' });

  const paket = paketTrial();
  const sekarang = Date.now();
  // Jendela untuk menyambungkan nomor (kalau tidak tersambung, server dibersihkan).
  const windowMs = (Number(pengaturan.trial_hours) || 24) * 60 * 60 * 1000;

  const serverId = db
    .prepare('INSERT INTO servers (user_id, name, package_id, is_trial, settings, expires_at, created_at) VALUES (?, ?, ?, 1, ?, ?, ?)')
    .run(user.id, 'Server Uji Sinyal', paket.id, JSON.stringify(PENGATURAN_BOT_AWAL), sekarang + windowMs, sekarang).lastInsertRowid;

  db.prepare(
    'INSERT INTO trial_claims (user_id, server_id, status, ip_key, device_id, email_kunci, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
  ).run(user.id, serverId, 'pending_phone', ipk, perangkat, emailK, sekarang);

  return db.prepare('SELECT * FROM servers WHERE id = ?').get(serverId);
});

/** Nomor boleh dipakai untuk server trial ini? (belum pernah pairing di situs ini) */
export function cekNomorTrial(phone) {
  if (!nomorBolehTrial(phone)) {
    gagal(409, 'Nomor ini tidak bisa dipakai untuk free trial. Pakai nomor yang belum pernah dipakai di sini, atau ambil paket berbayar.', { code: 'TRIAL_NOMOR' });
  }
}

/**
 * Dipanggil saat sebuah server trial berhasil tersambung ke nomor (dari
 * bot-manager). Mengaktifkan trial: catat nomor di ledger, set jam 24 jam,
 * tandai klaim 'active'. Mengembalikan { ok } atau { ok:false, alasan } kalau
 * nomor ternyata sudah pernah dipakai (QR mode yang lolos pre-check).
 */
export function aktifkanTrialSaatTersambung(serverId, phone, identity = '') {
  const claim = db.prepare("SELECT * FROM trial_claims WHERE server_id = ? AND status = 'pending_phone'").get(serverId);
  if (!claim) {
    // Bukan trial pending (mis. server berbayar) -> cukup catat nomornya.
    catatPairing(serverId, phone, identity);
    return { ok: true };
  }

  const nomor = String(phone || '').replace(/\D/g, '');
  if (!nomorBolehTrial(nomor)) {
    return { ok: false, alasan: 'Nomor ini sudah pernah dipakai, tidak bisa untuk free trial.' };
  }

  const sekarang = Date.now();
  const jam = (Number(s().trial_hours) || 24) * 60 * 60 * 1000;
  db.transaction(() => {
    catatPairing(serverId, nomor, identity);
    db.prepare('UPDATE servers SET expires_at = ? WHERE id = ?').run(sekarang + jam, serverId);
    db.prepare('UPDATE trial_claims SET status = ?, phone = ?, phone_hash = ?, activated_at = ? WHERE id = ?').run(
      'active',
      nomor,
      sidik('nomor', nomor),
      sekarang,
      claim.id,
    );
  })();
  return { ok: true };
}

/** Bersihkan server trial yang kedaluwarsa / tidak pernah tersambung (dipanggil berkala). */
export async function sapuTrial() {
  const sekarang = Date.now();

  // Pending yang lewat jendela & tidak pernah tersambung -> hapus server, klaim 'forfeited'.
  const pending = db
    .prepare("SELECT s.* FROM servers s WHERE s.is_trial = 1 AND s.phone IS NULL AND s.expires_at <= ?")
    .all(sekarang);
  for (const srv of pending) {
    await manager.stop(srv.id).catch(() => {});
    manager.hapusFolder(srv.id);
    db.prepare("UPDATE trial_claims SET status = 'forfeited' WHERE server_id = ? AND status = 'pending_phone'").run(srv.id);
    db.prepare('DELETE FROM servers WHERE id = ?').run(srv.id);
  }

  // Aktif tapi sudah habis -> tandai klaim 'ended' (bot sudah dimatikan oleh
  // cekKedaluwarsa milik manager; server dibiarkan supaya bisa di-upgrade).
  db.prepare("UPDATE trial_claims SET status = 'ended' WHERE status = 'active' AND server_id IN (SELECT id FROM servers WHERE is_trial = 1 AND expires_at <= ?)").run(sekarang);
}

export function mulaiSapuTrial() {
  setInterval(() => void sapuTrial().catch((e) => console.error('[trial] sapu gagal', e.message)), 5 * 60 * 1000).unref();
}

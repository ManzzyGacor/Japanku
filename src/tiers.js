import { db } from './db.js';
import { env } from './env.js';

/*
 Batas sumber daya per tier untuk tiap proses bot.

 Kenyataan di panel (Pterodactyl): panel membatasi SELURUH kontainer, bukan
 tiap bot. Cap CPU keras per bot butuh akses cgroup yang biasanya tidak ada di
 panel sewaan. Jadi yang dipakai di sini hanya yang benar-benar bisa dikontrol
 tanpa privilege:

 - maxMemoryMb: batas heap V8 lewat --max-old-space-size (mencegah satu bot
   menghabiskan memori kontainer).
 - nice: prioritas CPU (os.setPriority). Nilai lebih besar = prioritas lebih
   rendah. Tier murah diberi nice lebih tinggi supaya bot paket mahal lebih
   diprioritaskan saat CPU rebutan. Menurunkan prioritas tidak perlu root;
   menaikkan (nice < 0) butuh root, jadi kita tidak memakai nilai negatif.
*/

export const SUMBER_DAYA = {
  uji: { maxMemoryMb: 256, nice: 12 },
  antena: { maxMemoryMb: 256, nice: 6 },
  menara: { maxMemoryMb: 384, nice: 3 },
  satelit: { maxMemoryMb: 512, nice: 0 },
};

// Tier untuk server tanpa paket (data lama) dianggap antena.
const CADANGAN = { maxMemoryMb: env.botMaxMemoryMb, nice: 6 };

/** Kode tier (uji|antena|menara|satelit) sebuah server, atau null. */
export function kodeTierServer(server) {
  if (!server?.package_id) return null;
  const p = db.prepare('SELECT code FROM packages WHERE id = ?').get(server.package_id);
  return p?.code || null;
}

/** Batas sumber daya efektif untuk sebuah server. */
export function sumberDayaServer(server) {
  const kode = kodeTierServer(server);
  return SUMBER_DAYA[kode] ?? CADANGAN;
}

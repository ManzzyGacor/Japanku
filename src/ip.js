import crypto from 'crypto';
import net from 'net';
import { db } from './db.js';

/*
 Alamat IP klien & hashing untuk anti-abuse.

 - req.ip sudah benar kalau TRUST_PROXY diisi (app.set('trust proxy', ...) di
   server.js). Tanpa proxy, jangan percaya header apa pun.
 - IP & nomor TIDAK disimpan mentah untuk sinyal anti-abuse; yang disimpan hash
   HMAC-nya (lihat sidik()). Rahasia dari env APP_SECRET, atau dibuat sekali dan
   disimpan di settings (disarankan set APP_SECRET sendiri di produksi).
 - IP hanya SINYAL LUNAK: operator seluler Indonesia pakai CGNAT, ribuan orang
   berbagi satu IP. Jadi batas IP tidak pernah jadi satu-satunya gerbang.
*/

let rahasiaCache = null;
function rahasia() {
  if (rahasiaCache) return rahasiaCache;
  if (process.env.APP_SECRET) {
    rahasiaCache = process.env.APP_SECRET;
    return rahasiaCache;
  }
  const row = db.prepare("SELECT value FROM settings WHERE key = 'app_secret'").get();
  if (row?.value) {
    rahasiaCache = row.value;
  } else {
    rahasiaCache = crypto.randomBytes(32).toString('hex');
    db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)').run('app_secret', rahasiaCache);
  }
  return rahasiaCache;
}

/** Hash HMAC untuk sebuah nilai dalam suatu ruang (mis. sidik('nomor', '628..')). */
export function sidik(ruang, nilai) {
  return crypto.createHmac('sha256', rahasia()).update(`${ruang}:${nilai}`).digest('hex');
}

function normal(ip) {
  let s = String(ip || '');
  if (s.startsWith('::ffff:')) s = s.slice(7); // IPv4-mapped IPv6
  return s;
}

/** Perluas IPv6 jadi 8 hextet penuh (angka), atau null kalau bukan IPv6 valid. */
function hextet(ip) {
  if (!net.isIPv6(ip)) return null;
  let [kiri, kanan] = ip.split('::');
  const a = kiri ? kiri.split(':').filter(Boolean) : [];
  const b = kanan !== undefined ? (kanan ? kanan.split(':').filter(Boolean) : []) : null;
  let bagian;
  if (b === null) {
    bagian = a;
  } else {
    const isi = 8 - a.length - b.length;
    bagian = [...a, ...Array(Math.max(0, isi)).fill('0'), ...b];
  }
  if (bagian.length !== 8) return null;
  return bagian.map((h) => parseInt(h || '0', 16));
}

/** Kunci IP untuk pembatas: IPv4 utuh, IPv6 diringkas ke /64. */
export function ipKunci(req) {
  const ip = normal(req.ip);
  if (!ip) return '';
  if (net.isIPv4(ip)) return ip;
  const h = hextet(ip);
  if (h) return h.slice(0, 4).map((n) => n.toString(16)).join(':') + '::/64';
  return ip;
}

/** Kunci IP yang lebih lebar (IPv6 /48) untuk ambang eskalasi, bukan untuk blokir. */
export function ipKunciLebar(req) {
  const ip = normal(req.ip);
  if (!ip) return '';
  if (net.isIPv4(ip)) return ip;
  const h = hextet(ip);
  if (h) return h.slice(0, 3).map((n) => n.toString(16)).join(':') + '::/48';
  return ip;
}

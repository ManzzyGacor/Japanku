/** Lempar error dengan kode HTTP; ditangkap oleh penangan error di server.js */
export function gagal(status, message) {
  throw Object.assign(new Error(message), { status });
}

export const HARI_MS = 24 * 60 * 60 * 1000;

/** Ambil teks dari body, dipangkas, dengan batas panjang */
export function teks(nilai, { nama, min = 0, max = 200, wajib = true } = {}) {
  const hasil = typeof nilai === 'string' ? nilai.trim() : nilai == null ? '' : String(nilai).trim();
  if (wajib && !hasil) gagal(400, `${nama} wajib diisi.`);
  if (hasil && hasil.length < min) gagal(400, `${nama} minimal ${min} karakter.`);
  if (hasil.length > max) gagal(400, `${nama} maksimal ${max} karakter.`);
  return hasil;
}

/** Ambil bilangan bulat dari body, dengan batas bawah & atas */
export function bulat(nilai, { nama, min = -Infinity, max = Infinity } = {}) {
  const n = Number(nilai);
  if (!Number.isInteger(n)) gagal(400, `${nama} harus berupa angka bulat.`);
  if (n < min) gagal(400, `${nama} minimal ${min.toLocaleString('id-ID')}.`);
  if (n > max) gagal(400, `${nama} maksimal ${max.toLocaleString('id-ID')}.`);
  return n;
}

const POLA_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function email(nilai) {
  const hasil = teks(nilai, { nama: 'Email', max: 120 }).toLowerCase();
  if (!POLA_EMAIL.test(hasil)) gagal(400, 'Format email tidak valid.');
  return hasil;
}

/**
 * Rapikan nomor WhatsApp jadi format internasional tanpa tanda +.
 * "0812-3456-7890" / "+62 812 3456 7890" / "812345..." -> "6281234567890"
 */
export function nomorWa(nilai) {
  let n = String(nilai ?? '').replace(/\D/g, '');
  if (n.startsWith('0')) n = `62${n.slice(1)}`;
  else if (n.startsWith('8')) n = `62${n}`;
  if (n.length < 10 || n.length > 15) gagal(400, 'Nomor WhatsApp tidak valid. Contoh: 6281234567890');
  return n;
}

export function rupiah(n) {
  return `Rp${Number(n || 0).toLocaleString('id-ID')}`;
}

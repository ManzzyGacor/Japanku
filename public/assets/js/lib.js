/* Alat bantu bersama untuk semua halaman VaresaJasher */

/** Panggil API. Selalu JSON (server menolak permintaan non-JSON demi keamanan). */
export async function api(path, { method = 'GET', body } = {}) {
  const opsi = { method, headers: { Accept: 'application/json' }, credentials: 'same-origin' };
  if (method !== 'GET') {
    opsi.headers['Content-Type'] = 'application/json';
    opsi.body = JSON.stringify(body ?? {});
  }

  let res;
  try {
    res = await fetch(`/api${path}`, opsi);
  } catch {
    throw new ApiError('Tidak bisa terhubung ke server. Periksa koneksi kamu.', 0);
  }

  let data = null;
  try {
    data = await res.json();
  } catch {
    data = null;
  }

  if (!res.ok || !data?.success) {
    throw new ApiError(data?.message || `Terjadi kesalahan (${res.status}).`, res.status);
  }
  return data;
}

export class ApiError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

// ---------------------------------------------------------------------------
// Template HTML yang otomatis meng-escape isi (aman dari XSS)
// ---------------------------------------------------------------------------

class Raw {
  constructor(s) {
    this.s = s;
  }
  toString() {
    return this.s;
  }
}

/** Tandai teks sebagai HTML yang sudah aman (jangan dipakai untuk data pengguna!) */
export const raw = (s) => new Raw(String(s));

export function esc(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function render(v) {
  if (v == null || v === false || v === true) return '';
  if (Array.isArray(v)) return v.map(render).join('');
  if (v instanceof Raw) return v.s;
  return esc(v);
}

/** html`<p>${teksPengguna}</p>` -> isi di-escape; html di dalam html tidak di-escape dua kali */
export function html(strings, ...values) {
  let out = strings[0];
  values.forEach((v, i) => {
    out += render(v) + strings[i + 1];
  });
  return new Raw(out);
}

// ---------------------------------------------------------------------------
// Format
// ---------------------------------------------------------------------------

export const rupiah = (n) => `Rp${Number(n || 0).toLocaleString('id-ID')}`;

export function tanggal(ms, { jam = false } = {}) {
  if (!ms) return '-';
  return new Date(ms).toLocaleString('id-ID', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    ...(jam ? { hour: '2-digit', minute: '2-digit' } : {}),
  });
}

export function jam(ms) {
  return new Date(ms).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

/** "12 hari lagi" / "3 jam lagi" / "habis 2 hari lalu" */
export function sisaWaktu(ms) {
  const selisih = ms - Date.now();
  const abs = Math.abs(selisih);
  const hari = Math.floor(abs / 86400000);
  const jamSisa = Math.floor((abs % 86400000) / 3600000);
  const teks = hari >= 1 ? `${hari} hari` : jamSisa >= 1 ? `${jamSisa} jam` : `${Math.max(1, Math.floor(abs / 60000))} menit`;
  return selisih >= 0 ? `${teks} lagi` : `habis ${teks} lalu`;
}

// ---------------------------------------------------------------------------
// Antarmuka
// ---------------------------------------------------------------------------

export function toast(pesan, jenis = 'ok') {
  let wadah = document.querySelector('.toasts');
  if (!wadah) {
    wadah = document.createElement('div');
    wadah.className = 'toasts';
    wadah.setAttribute('role', 'status');
    wadah.setAttribute('aria-live', 'polite');
    document.body.append(wadah);
  }
  const el = document.createElement('div');
  el.className = `toast toast-${jenis}`;
  el.textContent = pesan;
  wadah.append(el);
  setTimeout(() => el.remove(), jenis === 'error' ? 6000 : 3500);
}

/** Jalankan aksi async sambil menampilkan status memuat di tombol */
export async function sambilMemuat(tombol, aksi) {
  if (tombol?.disabled) return undefined;
  tombol?.classList.add('is-loading');
  if (tombol) tombol.disabled = true;
  try {
    return await aksi();
  } finally {
    tombol?.classList.remove('is-loading');
    if (tombol) tombol.disabled = false;
  }
}

/** Ambil isi form sebagai objek */
export function dataForm(form) {
  return Object.fromEntries(new FormData(form).entries());
}

export async function salin(teks) {
  try {
    await navigator.clipboard.writeText(teks);
    toast('Disalin.');
  } catch {
    toast('Gagal menyalin. Salin manual ya.', 'error');
  }
}

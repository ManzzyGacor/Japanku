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

const fRupiah = new Intl.NumberFormat('id-ID');
export const rupiah = (n) => `Rp${fRupiah.format(Math.round(Number(n) || 0))}`;

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
// Kabar (toast) — gaya "Pusat Siaran" (§5.17)
// ---------------------------------------------------------------------------

// Ikon sebaris agar lib.js tidak bergantung pada ui.js (hindari impor memutar).
const IKON_KABAR = {
  ok: '<path d="M4.5 12.5l5 5 10-11"/>',
  galat: '<path d="M6 6l12 12M18 6L6 18"/>',
  info: '<circle cx="12" cy="12" r="2"/><path d="M7.8 7.8a6 6 0 0 0 0 8.4M16.2 7.8a6 6 0 0 1 0 8.4M4.9 4.9a10 10 0 0 0 0 14.2M19.1 4.9a10 10 0 0 1 0 14.2"/>',
};
const IKON_X = '<path d="M6 6l12 12M18 6L6 18"/>';

function ikonI(d) {
  return `<svg class="i" viewBox="0 0 24 24" aria-hidden="true">${d}</svg>`;
}

function wadahKabar() {
  let wadah = document.querySelector('.kabar-tumpuk');
  if (!wadah) {
    wadah = document.createElement('div');
    wadah.className = 'kabar-tumpuk';
    document.body.append(wadah);
  }
  return wadah;
}

/**
 * Tampilkan kabar.
 * @param {string} pesan Judul singkat (jadi headline tebal).
 * @param {'ok'|'error'|'galat'|'info'} jenis
 * @param {{ kicker?: string, detail?: string, durasi?: number }} [opsi]
 */
export function toast(pesan, jenis = 'ok', opsi = {}) {
  const peta = { ok: 'ok', error: 'galat', galat: 'galat', info: 'info' };
  const kind = peta[jenis] || 'ok';
  const kelas = { ok: 'kabar-ok', galat: 'kabar-galat', info: 'kabar-info' }[kind];

  const wadah = wadahKabar();
  const el = document.createElement('div');
  el.className = `kabar ${kelas}`;
  el.setAttribute('role', kind === 'galat' ? 'alert' : 'status');

  const ikon = document.createElement('span');
  ikon.className = 'kabar-ikon';
  ikon.innerHTML = ikonI(IKON_KABAR[kind]);

  const isi = document.createElement('div');
  isi.className = 'kabar-isi';
  if (opsi.kicker) {
    const k = document.createElement('span');
    k.className = 'kicker';
    k.textContent = opsi.kicker;
    isi.append(k);
  }
  const b = document.createElement('b');
  b.textContent = pesan;
  isi.append(b);
  if (opsi.detail) {
    const p = document.createElement('p');
    p.textContent = opsi.detail;
    isi.append(p);
  }

  const tutup = document.createElement('button');
  tutup.className = 'kabar-tutup';
  tutup.setAttribute('aria-label', 'Tutup');
  tutup.innerHTML = ikonI(IKON_X);

  el.append(ikon, isi, tutup);
  wadah.append(el);

  // auto-tutup; jeda saat disentuh/di-hover/difokus
  const total = opsi.durasi ?? (kind === 'galat' ? 8000 : 5000);
  let sisa = total;
  let mulai = Date.now();
  let timer = null;
  const buang = () => {
    clearTimeout(timer);
    el.style.transition = 'opacity 120ms, transform 120ms';
    el.style.opacity = '0';
    el.style.transform = 'translateY(8px)';
    setTimeout(() => el.remove(), 130);
  };
  const jalan = () => {
    mulai = Date.now();
    timer = setTimeout(buang, sisa);
  };
  const tahan = () => {
    clearTimeout(timer);
    sisa -= Date.now() - mulai;
  };
  tutup.addEventListener('click', buang);
  el.addEventListener('mouseenter', tahan);
  el.addEventListener('mouseleave', jalan);
  el.addEventListener('focusin', tahan);
  el.addEventListener('focusout', jalan);
  jalan();

  return buang;
}

// ---------------------------------------------------------------------------
// Antarmuka
// ---------------------------------------------------------------------------

/** Jalankan aksi async sambil menampilkan status memuat di tombol */
export async function sambilMemuat(tombol, aksi) {
  if (tombol?.disabled) return undefined;
  if (tombol) {
    tombol.classList.add('is-loading');
    tombol.setAttribute('aria-busy', 'true');
    tombol.disabled = true;
  }
  try {
    return await aksi();
  } finally {
    if (tombol) {
      tombol.classList.remove('is-loading');
      tombol.removeAttribute('aria-busy');
      tombol.disabled = false;
    }
  }
}

/** Ambil isi form sebagai objek */
export function dataForm(form) {
  return Object.fromEntries(new FormData(form).entries());
}

export async function salin(teks) {
  try {
    await navigator.clipboard.writeText(teks);
    toast('Disalin.', 'ok');
  } catch {
    toast('Gagal menyalin. Salin manual ya.', 'error');
  }
}

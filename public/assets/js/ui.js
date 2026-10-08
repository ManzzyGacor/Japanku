import { html, raw } from './lib.js';

// ---------------------------------------------------------------------------
// Ikon — satu set SVG sebaris di grid 24px (§3).
// Gaya (stroke 2.5, square, miter, fill none, 18px) diatur base.css `svg.i`.
// Nama kanonis Bahasa Indonesia; alias Inggris disediakan agar aman dipakai.
// ---------------------------------------------------------------------------

const D = {
  server: '<rect x="3" y="4" width="18" height="7"/><rect x="3" y="13" width="18" height="7"/><path d="M7 7.5h2M7 16.5h2"/>',
  tambah: '<path d="M12 4v16M4 12h16"/>',
  dompet: '<path d="M3 6h15v3"/><rect x="3" y="9" width="18" height="11"/><path d="M16 14.5h2"/>',
  akun: '<rect x="8" y="3.5" width="8" height="8"/><path d="M4 21v-3a4 4 0 0 1 4-4h8a4 4 0 0 1 4 4v3"/>',
  perisai: '<path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"/><path d="M9 12l2 2 4-4"/>',
  salin: '<rect x="8" y="8" width="12" height="12"/><path d="M16 8V4H4v12h4"/>',
  putar: '<path d="M7 4.5v15l12-7.5z"/>',
  jeda: '<path d="M8 5v14M16 5v14"/>',
  henti: '<rect x="5.5" y="5.5" width="13" height="13"/>',
  centang: '<path d="M4.5 12.5l5 5 10-11"/>',
  silang: '<path d="M6 6l12 12M18 6L6 18"/>',
  panah: '<path d="M4 12h15M13 6l6 6-6 6"/>',
  segar: '<path d="M20 5v5h-5"/><path d="M19.5 10A8 8 0 1 0 20 14"/>',
  unduh: '<path d="M12 4v11M7 10l5 5 5-5M4 20h16"/>',
  unggah: '<path d="M12 20V9M7 14l5-5 5 5M4 4h16"/>',
  gambar: '<rect x="3" y="4" width="18" height="16"/><circle cx="8.5" cy="9.5" r="1.5"/><path d="M4 18l5-5 4 4 3-3 4 4"/>',
  qr: '<rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><path d="M14 14h3v3M21 14v7M14 21h7"/>',
  telepon: '<path d="M5 4h4l2 5-3 2a12 12 0 0 0 5 5l2-3 5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2z"/>',
  kunci: '<rect x="5" y="10.5" width="14" height="10"/><path d="M8 10.5V7a4 4 0 0 1 8 0v3.5"/>',
  info: '<rect x="3" y="3" width="18" height="18"/><path d="M12 10.5v7M12 6.5v1"/>',
  peringatan: '<path d="M12 4l9 16H3z"/><path d="M12 10v4M12 17v.5"/>',
  chevron: '<path d="M5 9l7 7 7-7"/>',
  cari: '<circle cx="11" cy="11" r="6.5"/><path d="M16 16l4.5 4.5"/>',
  menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
  keluar: '<path d="M15 4h4v16h-4"/><path d="M10 17l-5-5 5-5M5 12h11"/>',
  jam: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3.5 2.5"/>',
  tag: '<path d="M4 4h8l8 8-8 8-8-8z"/><circle cx="8.5" cy="8.5" r="1.5"/>',
  saluran: '<path d="M4 10v4h3l8 5V5L7 10z"/><path d="M18 9a4 4 0 0 1 0 6"/>',
  cincin: '<circle cx="12" cy="12" r="8.5" stroke-dasharray="3 3"/>',
  siar: '<circle cx="12" cy="12" r="2"/><path d="M7.8 7.8a6 6 0 0 0 0 8.4M16.2 7.8a6 6 0 0 1 0 8.4M4.9 4.9a10 10 0 0 0 0 14.2M19.1 4.9a10 10 0 0 1 0 14.2"/>',
  kembali: '<path d="M15 18l-6-6 6-6"/>',
};

// alias Inggris / §3 -> nama kanonis
const ALIAS = {
  play: 'putar',
  stop: 'henti',
  pause: 'jeda',
  refresh: 'segar',
  copy: 'salin',
  download: 'unduh',
  upload: 'unggah',
  image: 'gambar',
  phone: 'telepon',
  lock: 'kunci',
  plus: 'tambah',
  wallet: 'dompet',
  user: 'akun',
  pengguna: 'akun',
  shield: 'perisai',
  admin: 'perisai',
  broadcast: 'siar',
  check: 'centang',
  x: 'silang',
  tutup: 'silang',
  alert: 'peringatan',
  'arrow-right': 'panah',
  arrowRight: 'panah',
  panahKanan: 'panah',
  'chevron-down': 'chevron',
  chevronBawah: 'chevron',
  search: 'cari',
  logout: 'keluar',
  clock: 'jam',
  waktu: 'jam',
  channel: 'saluran',
  'status-ring': 'cincin',
  statusRing: 'cincin',
  back: 'kembali',
};

function svg(d) {
  return raw(`<svg class="i" viewBox="0 0 24 24" aria-hidden="true">${d}</svg>`);
}

// objek ikon siap pakai (Raw) + fallback kosong untuk nama tak dikenal
export const ikon = new Proxy(
  {},
  {
    get(_, nama) {
      const kunci = D[nama] ? nama : ALIAS[nama];
      return kunci && D[kunci] ? svg(D[kunci]) : raw('');
    },
  },
);

// ---------------------------------------------------------------------------
// Status bot -> lencana (§5.4)
// ---------------------------------------------------------------------------

/** { cls, label } untuk status server */
export function statusInfo(server) {
  const s = server?.status;
  if (s === 'expired') return { cls: 'lencana-habis', label: 'Kedaluwarsa' };
  if (s === 'online') return { cls: 'lencana-ok', label: 'Terhubung' };
  if (s === 'pairing') return { cls: 'lencana-tunggu', label: 'Menunggu pairing' };
  if (s === 'qr') return { cls: 'lencana-tunggu', label: 'Menunggu scan QR' };
  if (s === 'starting' || s === 'connecting') return { cls: 'lencana-sambung', label: 'Menyambung' };
  if (s === 'reconnecting') return { cls: 'lencana-sambung', label: 'Menyambung ulang' };
  if (s === 'stopping') return { cls: 'lencana-sambung', label: 'Mematikan' };
  if (s === 'error') return { cls: 'lencana-putus', label: 'Error' };
  return server?.phone ? { cls: 'lencana-putus', label: 'Mati' } : { cls: 'lencana-habis', label: 'Belum terhubung' };
}

export function badgeStatus(server) {
  const { cls, label } = statusInfo(server);
  return html`<span class="lencana ${cls}">${label}</span>`;
}

/** Bot sedang berjalan / sedang menyambung? */
export function sedangJalan(status) {
  return ['online', 'starting', 'connecting', 'reconnecting', 'pairing', 'qr'].includes(status);
}

// ---------------------------------------------------------------------------
// Dialog (§5.18) — native <dialog>, kartu + slug, lembar bawah di telepon
// ---------------------------------------------------------------------------

function bukaDialog({ slug, isi }, { saatKirim } = {}) {
  const dialog = document.createElement('dialog');
  dialog.className = 'dialog';
  dialog.innerHTML = html`
    <header class="slug"><span class="slug-judul">${slug}</span></header>
    ${isi}
  `.s;
  document.body.append(dialog);

  return new Promise((resolve) => {
    let hasil = null;
    const form = dialog.querySelector('form');

    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const nilai = saatKirim ? saatKirim(form) : true;
      if (nilai === undefined) return; // validasi gagal, biarkan dialog terbuka
      hasil = nilai;
      dialog.close();
    });
    dialog.querySelector('[data-batal]')?.addEventListener('click', () => dialog.close());
    dialog.addEventListener('cancel', () => (hasil = null));
    dialog.addEventListener('close', () => {
      dialog.remove();
      resolve(hasil);
    });

    dialog.showModal();
    (dialog.querySelector('input, select, textarea') || dialog.querySelector('[data-batal]'))?.focus();
  });
}

/**
 * Minta konfirmasi. Mengembalikan true kalau disetujui.
 * @param {{judul: string, pesan?: string, ok?: string, batal?: string, bahaya?: boolean, slug?: string}} opsi
 */
export async function konfirmasi({ judul, pesan = '', ok = 'Ya, lanjutkan', batal = 'Batal', bahaya = false, slug = 'Konfirmasi' }) {
  const hasil = await bukaDialog({
    slug,
    isi: html`
      <form method="dialog" class="dialog-isi" novalidate>
        <h2 class="dialog-judul">${judul}</h2>
        ${pesan ? html`<p class="dialog-pesan">${pesan}</p>` : ''}
        <div class="dialog-aksi">
          <button type="button" class="btn btn-hantu" data-batal>${batal}</button>
          <button type="submit" class="btn ${raw(bahaya ? 'btn-bahaya' : 'btn-utama')}">${ok}</button>
        </div>
      </form>`,
  });
  return hasil === true;
}

/**
 * Dialog berisi form kecil. Mengembalikan objek isian, atau null kalau dibatalkan.
 * fields: [{ name, label, type = 'text'|'number'|'tel'|'textarea'|'select'|'checkbox', value,
 *            placeholder, hint, opsi (teks ".opsi" di label), required, options }]
 */
export async function formDialog({ judul, pesan = '', fields, ok = 'Simpan', batal = 'Batal', bahaya = false, slug, validasi }) {
  const isian = fields.map((f) => {
    const id = `f_${f.name}`;
    if (f.type === 'checkbox') {
      return html`<label class="centang" style="margin-top:16px"><input type="checkbox" name="${f.name}" ${raw(f.value ? 'checked' : '')}><span>${f.label}</span></label>`;
    }
    let kontrol;
    if (f.type === 'textarea') {
      kontrol = html`<textarea class="isian" id="${id}" name="${f.name}" placeholder="${f.placeholder ?? ''}" ${raw(f.required ? 'required' : '')}>${f.value ?? ''}</textarea>`;
    } else if (f.type === 'select') {
      kontrol = html`<select class="isian" id="${id}" name="${f.name}">${f.options.map(
        (o) => html`<option value="${o.value}" ${raw(String(o.value) === String(f.value) ? 'selected' : '')}>${o.label}</option>`,
      )}</select>`;
    } else {
      kontrol = html`<input class="isian" id="${id}" name="${f.name}" type="${f.type ?? 'text'}" value="${f.value ?? ''}" placeholder="${f.placeholder ?? ''}" ${raw(f.required ? 'required' : '')} ${raw(f.type === 'number' ? 'inputmode="numeric"' : '')}>`;
    }
    return html`<div class="field">
      <label class="label" for="${id}">${f.label}${f.opsi ? html` <span class="opsi">${f.opsi}</span>` : ''}</label>
      ${kontrol}
      ${f.hint ? html`<p class="bantu">${f.hint}</p>` : ''}
    </div>`;
  });

  return bukaDialog(
    {
      slug: slug || judul,
      isi: html`
        <form method="dialog" class="dialog-isi" novalidate>
          ${slug ? html`<h2 class="dialog-judul">${judul}</h2>` : ''}
          ${pesan ? html`<p class="dialog-pesan">${pesan}</p>` : ''}
          <div class="catatan-bahaya" data-error role="alert" hidden></div>
          ${isian}
          <div class="dialog-aksi">
            <button type="button" class="btn btn-hantu" data-batal>${batal}</button>
            <button type="submit" class="btn ${raw(bahaya ? 'btn-bahaya' : 'btn-utama')}">${ok}</button>
          </div>
        </form>`,
    },
    {
      saatKirim: (form) => {
        const data = {};
        for (const f of fields) {
          const el = form.elements[f.name];
          data[f.name] = f.type === 'checkbox' ? el.checked : el.value.trim();
        }
        const salah = fields.find((f) => f.required && f.type !== 'checkbox' && !data[f.name]) && 'Lengkapi isian yang wajib.';
        const pesanSalah = salah || validasi?.(data);
        if (pesanSalah) {
          const kotak = form.querySelector('[data-error]');
          kotak.textContent = pesanSalah;
          kotak.hidden = false;
          return undefined;
        }
        return data;
      },
    },
  );
}

import { html, raw } from './lib.js';

// Ikon garis sederhana (24x24, mengikuti currentColor)
const garis = (d) =>
  raw(`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`);

export const ikon = {
  server: garis('<rect x="3" y="4" width="18" height="7" rx="2"/><rect x="3" y="13" width="18" height="7" rx="2"/><path d="M7 7.5h.01M7 16.5h.01"/>'),
  tambah: garis('<circle cx="12" cy="12" r="9"/><path d="M12 8v8M8 12h8"/>'),
  dompet: garis('<path d="M4 7a2 2 0 0 1 2-2h12v4"/><rect x="3" y="9" width="18" height="11" rx="2"/><path d="M16 14.5h.01"/>'),
  akun: garis('<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>'),
  admin: garis('<path d="M12 3l8 3v6c0 4.5-3.4 8.2-8 9-4.6-.8-8-4.5-8-9V6l8-3z"/><path d="M9 12l2 2 4-4"/>'),
  keluar: garis('<path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3"/><path d="M10 17l-5-5 5-5M5 12h11"/>'),
  kembali: garis('<path d="M15 18l-6-6 6-6"/>'),
};

/** Label & warna untuk status bot */
export function statusInfo(server) {
  const s = server.status;
  if (s === 'expired') return { cls: 'badge-bad', label: 'Kedaluwarsa' };
  if (s === 'online') return { cls: 'badge-online', label: 'Online' };
  if (s === 'pairing') return { cls: 'badge-wait', label: 'Menunggu pairing' };
  if (s === 'qr') return { cls: 'badge-wait', label: 'Menunggu scan QR' };
  if (s === 'starting' || s === 'connecting') return { cls: 'badge-info', label: 'Menyambung' };
  if (s === 'reconnecting') return { cls: 'badge-wait', label: 'Menyambung ulang' };
  if (s === 'stopping') return { cls: 'badge-off', label: 'Mematikan' };
  if (s === 'error') return { cls: 'badge-bad', label: 'Error' };
  return server.phone ? { cls: 'badge-off', label: 'Mati' } : { cls: 'badge-off', label: 'Belum terhubung' };
}

export function badgeStatus(server) {
  const { cls, label } = statusInfo(server);
  return html`<span class="badge ${cls}">${label}</span>`;
}

/** Bot sedang berjalan / sedang menyambung? */
export function sedangJalan(status) {
  return ['online', 'starting', 'connecting', 'reconnecting', 'pairing', 'qr'].includes(status);
}

// ---------------------------------------------------------------------------
// Dialog
// ---------------------------------------------------------------------------

function bukaDialog(isi, { saatKirim } = {}) {
  const dialog = document.createElement('dialog');
  dialog.className = 'modal';
  dialog.innerHTML = isi.s;
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
    dialog.addEventListener('close', () => {
      dialog.remove();
      resolve(hasil);
    });

    dialog.showModal();
    dialog.querySelector('input, select, textarea')?.focus();
  });
}

/**
 * Minta konfirmasi. Mengembalikan true kalau disetujui.
 * @param {{judul: string, pesan?: string, ok?: string, bahaya?: boolean}} opsi
 */
export async function konfirmasi({ judul, pesan = '', ok = 'Ya, lanjutkan', bahaya = false }) {
  const hasil = await bukaDialog(html`
    <form method="dialog">
      <h3>${judul}</h3>
      ${pesan ? html`<p class="desc">${pesan}</p>` : ''}
      <div class="modal-actions">
        <button type="button" class="btn btn-ghost" data-batal>Batal</button>
        <button type="submit" class="btn ${bahaya ? 'btn-danger' : 'btn-primary'}">${ok}</button>
      </div>
    </form>`);
  return hasil === true;
}

/**
 * Dialog berisi form kecil. Mengembalikan objek isian, atau null kalau dibatalkan.
 * fields: [{ name, label, type = 'text'|'number'|'textarea'|'select'|'checkbox', value, placeholder, hint, required, options }]
 */
export async function formDialog({ judul, pesan = '', fields, ok = 'Simpan', bahaya = false, validasi }) {
  const isian = fields.map((f) => {
    const id = `f_${f.name}`;
    if (f.type === 'checkbox') {
      return html`<label class="check" style="margin-bottom:16px"><input type="checkbox" name="${f.name}" ${f.value ? raw('checked') : ''}><span>${f.label}</span></label>`;
    }
    let kontrol;
    if (f.type === 'textarea') {
      kontrol = html`<textarea class="textarea" id="${id}" name="${f.name}" placeholder="${f.placeholder ?? ''}" ${f.required ? raw('required') : ''}>${f.value ?? ''}</textarea>`;
    } else if (f.type === 'select') {
      kontrol = html`<select class="select" id="${id}" name="${f.name}">${f.options.map(
        (o) => html`<option value="${o.value}" ${String(o.value) === String(f.value) ? raw('selected') : ''}>${o.label}</option>`,
      )}</select>`;
    } else {
      kontrol = html`<input class="input" id="${id}" name="${f.name}" type="${f.type ?? 'text'}" value="${f.value ?? ''}" placeholder="${f.placeholder ?? ''}" ${f.required ? raw('required') : ''} ${f.type === 'number' ? raw('step="any"') : ''}>`;
    }
    return html`<div class="field"><label for="${id}">${f.label}</label>${kontrol}${f.hint ? html`<span class="hint">${f.hint}</span>` : ''}</div>`;
  });

  return bukaDialog(
    html`
      <form method="dialog" novalidate>
        <h3>${judul}</h3>
        ${pesan ? html`<p class="desc">${pesan}</p>` : ''}
        <div class="alert alert-error" data-error hidden></div>
        ${isian}
        <div class="modal-actions">
          <button type="button" class="btn btn-ghost" data-batal>Batal</button>
          <button type="submit" class="btn ${bahaya ? 'btn-danger' : 'btn-primary'}">${ok}</button>
        </div>
      </form>`,
    {
      saatKirim: (form) => {
        const data = {};
        for (const f of fields) {
          const el = form.elements[f.name];
          data[f.name] = f.type === 'checkbox' ? el.checked : el.value.trim();
        }
        const salah =
          fields.find((f) => f.required && f.type !== 'checkbox' && !data[f.name]) && 'Lengkapi isian yang wajib.';
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

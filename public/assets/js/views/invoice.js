import { api, html, raw, rupiah, tanggal, toast, sambilMemuat } from '../lib.js';
import { ikon, konfirmasi } from '../ui.js';

// ===========================================================================
// 5.15 — Halaman tagihan QRIS (struk termal + hitung mundur)
// ===========================================================================

const JEDA_POLL = 3000; // cek status tiap ~3 dtk selama pending

// ---------------------------------------------------------------------------
// Pembantu jaringan khusus pembayaran.
// Seperti api() tapi mempertahankan code/orderId/invoice dari body error,
// yang dibutuhkan untuk PENDING_EXISTS, SALDO_CUKUP & INVOICE_SUDAH_LUNAS.
// ---------------------------------------------------------------------------
export async function kirimTagihan(path, { method = 'POST', body } = {}) {
  const opsi = {
    method,
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    credentials: 'same-origin',
    body: JSON.stringify(body ?? {}),
  };
  let res;
  try {
    res = await fetch(`/api${path}`, opsi);
  } catch {
    throw Object.assign(new Error('Tidak bisa terhubung ke server. Periksa koneksi kamu.'), { status: 0 });
  }
  let data = null;
  try {
    data = await res.json();
  } catch {
    data = null;
  }
  if (!res.ok || !data?.success) {
    throw Object.assign(new Error(data?.message || `Terjadi kesalahan (${res.status}).`), {
      status: res.status,
      code: data?.code,
      orderId: data?.orderId,
      invoice: data?.invoice,
    });
  }
  return data;
}

// ---------------------------------------------------------------------------
// Format waktu (zona WIB, gaya mono "07.10.2026 14.27" & "14.32 WIB")
// ---------------------------------------------------------------------------
const WIB = 'Asia/Jakarta';
const tglMono = (ms) => {
  const tgl = new Date(ms).toLocaleDateString('id-ID', { timeZone: WIB, day: '2-digit', month: '2-digit', year: 'numeric' });
  const jm = new Date(ms).toLocaleTimeString('id-ID', { timeZone: WIB, hour: '2-digit', minute: '2-digit' });
  return `${tgl} ${jm}`;
};
export const jamWib = (ms) => `${new Date(ms).toLocaleTimeString('id-ID', { timeZone: WIB, hour: '2-digit', minute: '2-digit' })} WIB`;

/** Status invoice sebagai cap-mini (§5.5). Dipakai juga oleh wallet.js. */
export function capInvoice(status) {
  if (status === 'completed') return html`<span class="cap-mini hijau">Lunas</span>`;
  if (status === 'pending') return html`<span class="cap-mini kuning">Menunggu</span>`;
  if (status === 'cancelled') return html`<span class="cap-mini redup">Dibatalkan</span>`;
  return html`<span class="cap-mini redup">Hangus</span>`; // expired
}

// Judul kecil di kop struk & label baris "isi saldo / server"
const judulTagihan = (inv) =>
  inv.kind === 'buy' ? 'Tagihan beli server' : inv.kind === 'renew' ? 'Tagihan perpanjang server' : 'Tagihan isi saldo';
const labelSubtotal = (inv) =>
  inv.kind === 'buy' ? 'Beli server' : inv.kind === 'renew' ? 'Perpanjang server' : 'Isi saldo';

// ===========================================================================
// View
// ===========================================================================

export async function halamanInvoice({ view, params, app, masihAktif }) {
  const orderId = String(params[0] || '');
  app.setJudul('Tagihan');

  let inv = null;
  let skew = 0; // Date.now() lokal - inv.now server (koreksi beda jam)
  let poll = null;
  let tick = null;
  let umum60 = false;
  let umumHabis = false;

  // ---- Ambil invoice pertama kali ----
  try {
    const r = await api(`/payment/invoices/${encodeURIComponent(orderId)}?qr=1`);
    inv = r.invoice;
  } catch (error) {
    if (!masihAktif()) return;
    if (error.status === 404) {
      toast('Tagihan tidak ditemukan.', 'error');
      app.pergi('/dashboard/saldo');
      return;
    }
    throw error;
  }
  if (!masihAktif()) return;
  skew = Date.now() - inv.now;

  const simulasi = !!app.site?.qris?.simulasi;
  const sisaMs = () => Math.max(0, inv.expiresAt - (Date.now() - skew));

  // -------------------------------------------------------------------------
  // Bagian struk per status
  // -------------------------------------------------------------------------
  const qrGambar = () => {
    const q = inv.qr || {};
    const src = q.dataUrl || q.url;
    if (!src) return html`<p class="qr-ket">QR belum siap. Coba tekan "Cek status".</p>`;
    return html`<img src="${src}" alt="Kode QRIS ${inv.orderId}" width="320" height="320" data-qr-img data-qr-fallback="${q.url || ''}">`;
  };

  const rincian = () => html`
    <dl class="ringkasan">
      <div><dt>${labelSubtotal(inv)}</dt><dd>${rupiah(inv.subtotal)}</dd></div>
      <div><dt>Biaya admin</dt><dd>${rupiah(inv.fee)}</dd></div>
      <div class="total"><dt>Total</dt><dd>${rupiah(inv.amount)}</dd></div>
    </dl>`;

  const bagianPending = () => html`
    <dl class="baris-titik">
      <div><dt>No. tagihan</dt><dd>${inv.orderId}</dd></div>
      <div><dt>Dibuat</dt><dd>${tglMono(inv.createdAt)}</dd></div>
    </dl>
    <p class="struk-status"><span class="lencana lencana-tunggu">Menunggu pembayaran</span></p>
    <div class="qr-bingkai">${qrGambar()}</div>
    <button class="btn btn-sekunder btn-blok" type="button" data-aksi="simpan-qr">${ikon.unduh} Simpan gambar QR</button>
    <p class="qr-ket">Bayar dari HP ini? Simpan gambar QR, lalu buka e-wallet &rsaquo; Bayar/Scan &rsaquo; pilih dari galeri.</p>
    <p class="qr-ket" style="margin-top:8px">Pindai pakai GoPay, OVO, DANA, ShopeePay, atau m-banking mana pun.</p>
    <div class="hitung-mundur">
      <span class="kicker">Sisa waktu bayar</span>
      <b data-cd>--:--</b>
      <div><div class="bar bar-tipis"><i data-cd-bar style="width:100%"></i></div><small>Hangus pukul ${jamWib(inv.expiresAt)}</small></div>
    </div>
    ${rincian()}
    <p class="catatan" style="margin-top:12px">Bayar tepat <b>${rupiah(inv.amount)}</b>.</p>
    <div class="struk-aksi">
      <button class="btn btn-sekunder btn-s" type="button" data-aksi="cek">${ikon.segar} Cek status</button>
      <button class="btn btn-hantu btn-s" type="button" data-aksi="batal">Batalkan</button>
    </div>
    ${simulasi ? html`<button class="btn btn-utama btn-blok" type="button" data-aksi="simulasi" style="margin-top:10px">Bayar (simulasi)</button>` : ''}
    <p class="struk-kaki">&mdash; simpan struk ini sampai saldo masuk &mdash;</p>`;

  const barisLunas = () => {
    if (inv.kind === 'buy' && inv.result === 'ok') return html`<p class="struk-masuk">Server dibuat &amp; aktif.</p>`;
    if (inv.kind === 'renew' && inv.result === 'ok') return html`<p class="struk-masuk">Server diperpanjang.</p>`;
    return html`<p class="struk-masuk">Saldo masuk +${rupiah(inv.subtotal)}</p>`;
  };

  const tombolLunas = () => {
    if ((inv.kind === 'buy' || inv.kind === 'renew') && inv.result === 'ok' && inv.serverId) {
      return html`<a class="btn btn-utama btn-blok" href="/dashboard/server/${inv.serverId}">Ke server ${ikon.panah}</a>`;
    }
    return html`<a class="btn btn-utama btn-blok" href="/dashboard/saldo">Ke saldo ${ikon.panah}</a>`;
  };

  const bagianLunas = (animasi) => html`
    <div class="cap ${raw(animasi ? 'cap-masuk' : '')}" aria-hidden="true">Lunas<small>${tglMono(inv.completedAt || inv.now).split(' ')[0]}</small></div>
    <dl class="baris-titik">
      <div><dt>No. tagihan</dt><dd>${inv.orderId}</dd></div>
      <div><dt>Dibayar</dt><dd>${tglMono(inv.completedAt || inv.now)}</dd></div>
      <div><dt>Lewat</dt><dd>QRIS</dd></div>
    </dl>
    ${barisLunas()}
    ${inv.result === 'saldo_only' && inv.resultNote ? html`<p class="catatan" style="margin-top:10px">${inv.resultNote}</p>` : ''}
    ${rincian()}
    <div class="struk-aksi">${tombolLunas()}</div>
    <p class="struk-kaki">&mdash; struk ini sudah lunas &mdash;</p>`;

  const bagianTutup = () => {
    const batal = inv.status === 'cancelled';
    return html`
      <dl class="baris-titik">
        <div><dt>No. tagihan</dt><dd>${inv.orderId}</dd></div>
        <div><dt>Dibuat</dt><dd>${tglMono(inv.createdAt)}</dd></div>
      </dl>
      <p class="struk-status"><span class="lencana lencana-habis">${batal ? 'Dibatalkan' : 'Kedaluwarsa'}</span></p>
      <div class="qr-bingkai hangus"><span class="cap cap-tinta" aria-hidden="true">${batal ? 'Dibatalkan' : 'Hangus'}</span></div>
      <div class="hitung-mundur">
        <span class="kicker">Sisa waktu bayar</span>
        <b class="kritis">00:00</b>
        <div><div class="bar bar-tipis"><i style="width:0"></i></div><small>Tagihan sudah ditutup.</small></div>
      </div>
      ${rincian()}
      <div class="struk-aksi"><button class="btn btn-utama btn-blok" type="button" data-aksi="baru">Buat QRIS baru ${ikon.panah}</button></div>
      <p class="struk-kaki">&mdash; tagihan ini tidak berlaku lagi &mdash;</p>`;
  };

  // -------------------------------------------------------------------------
  // Gambar seluruh halaman
  // -------------------------------------------------------------------------
  function gambar(animasiLunas = false) {
    if (!masihAktif()) return;
    const isi =
      inv.status === 'completed' ? bagianLunas(animasiLunas) : inv.status === 'pending' ? bagianPending() : bagianTutup();

    view.innerHTML = html`<div id="halamanInvoice" class="inv-halaman">
      <a class="kembali-tautan" href="/dashboard/saldo">${ikon.kembali} Saldo</a>
      <div class="struk-bungkus">
        <article class="struk" aria-label="Tagihan ${inv.orderId}">
          <header class="struk-kop">
            <span class="merek-tanda">VJ</span>
            <div><b>VaresaJasher</b><small>${judulTagihan(inv)}</small></div>
            <span class="qris-tag">QRIS</span>
          </header>
          ${isi}
        </article>
      </div>
      <p class="sr" aria-live="polite" data-umum></p>
    </div>`.s;

    pasang(view.querySelector('#halamanInvoice'));
    if (inv.status === 'pending') perbaruiHitung();
  }

  // -------------------------------------------------------------------------
  // Event
  // -------------------------------------------------------------------------
  function pasang(wrap) {
    const im = wrap.querySelector('[data-qr-img]');
    if (im) {
      im.addEventListener('error', () => {
        const fb = im.getAttribute('data-qr-fallback');
        if (fb && im.src !== fb) im.src = fb;
      });
    }

    wrap.addEventListener('click', async (e) => {
      const el = e.target.closest('[data-aksi]');
      if (!el) return;
      const aksi = el.dataset.aksi;

      if (aksi === 'cek') return void sambilMemuat(el, () => cekStatus(true));
      if (aksi === 'simpan-qr') return void simpanGambarQr();

      if (aksi === 'simulasi') {
        try {
          const d = await sambilMemuat(el, () =>
            kirimTagihan(`/payment/invoices/${encodeURIComponent(orderId)}/simulasi-bayar`, { body: {} }),
          );
          terapkan(d.invoice);
        } catch (err) {
          toast(err.message, 'error');
        }
        return;
      }

      if (aksi === 'batal') {
        const ok = await konfirmasi({
          judul: 'Batalkan tagihan ini?',
          slug: 'Batalkan',
          pesan: 'QR tidak bisa dipakai lagi setelah dibatalkan.',
          ok: 'Ya, batalkan',
          bahaya: true,
        });
        if (!ok) return;
        try {
          const d = await sambilMemuat(el, () =>
            kirimTagihan(`/payment/invoices/${encodeURIComponent(orderId)}/cancel`, { body: {} }),
          );
          terapkan(d.invoice);
          toast('Tagihan dibatalkan.');
        } catch (err) {
          if (err.status === 409 && err.invoice) {
            terapkan(err.invoice);
            toast('Tagihan ternyata sudah dibayar.', 'info');
          } else if (err.status === 409) {
            await cekStatus(false);
          } else {
            toast(err.message, 'error');
          }
        }
        return;
      }

      if (aksi === 'baru') {
        const ke =
          inv.kind === 'buy'
            ? '/dashboard/beli'
            : inv.kind === 'renew' && inv.serverId
            ? `/dashboard/server/${inv.serverId}`
            : '/dashboard/saldo';
        app.pergi(ke);
      }
    });
  }

  // -------------------------------------------------------------------------
  // Hitung mundur (skew-corrected) + pengumuman aksesibilitas
  // -------------------------------------------------------------------------
  function perbaruiHitung() {
    const el = view.querySelector('[data-cd]');
    if (!el) return;
    const sisa = sisaMs();
    const dtk = Math.round(sisa / 1000);
    el.textContent = `${String(Math.floor(dtk / 60)).padStart(2, '0')}:${String(dtk % 60).padStart(2, '0')}`;
    el.classList.toggle('kritis', dtk <= 60);
    const bar = view.querySelector('[data-cd-bar]');
    if (bar) {
      const ttl = Math.max(1, inv.expiresAt - inv.createdAt);
      bar.style.width = `${Math.max(0, Math.min(100, (sisa / ttl) * 100))}%`;
    }
    if (dtk <= 60 && dtk > 0 && !umum60) {
      umum60 = true;
      umumkan('Sisa satu menit untuk membayar.');
    }
    if (dtk <= 0 && !umumHabis) {
      umumHabis = true;
      umumkan('Waktu pembayaran habis.');
      cekStatus(false); // minta server tutup & segarkan tampilan
    }
  }

  function umumkan(teks) {
    const el = view.querySelector('[data-umum]');
    if (el) el.textContent = teks;
  }

  // -------------------------------------------------------------------------
  // Terapkan invoice baru (poll / aksi)
  // -------------------------------------------------------------------------
  function terapkan(nv) {
    if (!nv || !masihAktif()) return;
    const lama = inv ? inv.status : null;
    const samaStatus = lama === nv.status;
    inv = nv;
    skew = Date.now() - inv.now;
    if (samaStatus) {
      perbaruiHitung();
      return;
    }
    const jadiLunas = inv.status === 'completed' && lama && lama !== 'completed';
    gambar(jadiLunas);
    if (jadiLunas) rayakan();
    aturTimer();
  }

  function rayakan() {
    app.muatUlangUser().catch(() => {}); // kilat chip saldo + perbarui nav
    if (inv.kind === 'buy' && inv.result === 'ok') {
      toast('Server aktif', 'ok', { kicker: 'Pembayaran lunas', detail: 'Server sudah dibuat dan siap ditautkan.' });
    } else if (inv.kind === 'renew' && inv.result === 'ok') {
      toast('Server diperpanjang', 'ok', { kicker: 'Pembayaran lunas' });
    } else {
      toast('Saldo masuk', 'ok', { kicker: 'Saldo masuk', detail: `+${rupiah(inv.subtotal)} ditambahkan ke saldo.` });
    }
  }

  async function cekStatus(manual) {
    let data;
    try {
      data = await api(`/payment/invoices/${encodeURIComponent(orderId)}?qr=1`);
    } catch (error) {
      if (manual && masihAktif()) toast(error.message, 'error');
      return;
    }
    if (!masihAktif()) return;
    terapkan(data.invoice);
    if (manual && data.invoice.status === 'pending') toast('Masih menunggu pembayaran.', 'info');
  }

  // -------------------------------------------------------------------------
  // Timer: poll 3 dtk + tick hitung mundur 1 dtk, hanya saat pending
  // -------------------------------------------------------------------------
  function aturTimer() {
    if (inv.status === 'pending') {
      if (!poll) poll = setInterval(() => { if (!document.hidden) cekStatus(false); }, JEDA_POLL);
      if (!tick) tick = setInterval(perbaruiHitung, 1000);
      perbaruiHitung();
    } else {
      clearInterval(poll); poll = null;
      clearInterval(tick); tick = null;
    }
  }

  // -------------------------------------------------------------------------
  // Simpan / bagikan gambar QR (PNG + nomor tagihan & total)
  // -------------------------------------------------------------------------
  function muatGambar(src) {
    return new Promise((res, rej) => {
      const im = new Image();
      im.onload = () => res(im);
      im.onerror = rej;
      im.src = src;
    });
  }

  async function simpanGambarQr() {
    const q = inv.qr || {};
    const src = q.dataUrl || q.url;
    if (!src) return void toast('Gambar QR belum siap.', 'error');

    let blob;
    try {
      const img = await muatGambar(src);
      const pad = 48;
      const qsz = 480;
      const capH = 128;
      const c = document.createElement('canvas');
      c.width = qsz + pad * 2;
      c.height = qsz + pad + capH;
      const ctx = c.getContext('2d');
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, c.width, c.height);
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(img, pad, pad, qsz, qsz);
      ctx.fillStyle = '#16130F';
      ctx.textAlign = 'center';
      ctx.font = '700 36px "IBM Plex Mono", ui-monospace, monospace';
      ctx.fillText(inv.orderId, c.width / 2, qsz + pad + 48);
      ctx.font = '600 30px "IBM Plex Mono", ui-monospace, monospace';
      ctx.fillText(`Total ${rupiah(inv.amount)}`, c.width / 2, qsz + pad + 92);
      blob = await new Promise((r) => c.toBlob(r, 'image/png'));
      if (!blob) throw new Error('kosong');
    } catch {
      // Kanvas gagal (mis. gambar lintas-asal) — buka QR mentah sebagai cadangan.
      if (q.url) window.open(q.url, '_blank', 'noopener');
      else toast('Tidak bisa menyimpan gambar QR.', 'error');
      return;
    }

    const nama = `${inv.orderId}.png`;
    const file = new File([blob], nama, { type: 'image/png' });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      try {
        await navigator.share({ files: [file], title: `QRIS ${inv.orderId}`, text: `Tagihan ${inv.orderId}` });
        return;
      } catch (err) {
        if (err && err.name === 'AbortError') return; // dibatalkan pengguna
      }
    }
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = nama;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  // ---- Mulai ----
  gambar(false);
  aturTimer();

  return () => {
    clearInterval(poll);
    clearInterval(tick);
  };
}

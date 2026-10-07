/* Halaman publik VaresaJasher — "Pusat Siaran"
   Perilaku bersama untuk semua halaman statis (harga, faq, panduan, syarat,
   privasi): dateline masthead, hitung siaran langsung, pita pengumuman, tukar
   tombol Masuk/Daftar jadi Dashboard saat sudah login, menu seluler, buka
   otomatis item <details> dari #anchor, dan daftar harga /harga dari
   /api/packages. Semua data pengguna dirender lewat html`` (otomatis di-escape). */

import { api, html, rupiah } from './lib.js';

/* -------------------------------------------------------------------------
   1. Dateline masthead — Intl id-ID: "Edisi Rabu, 07.10.2026"
   ------------------------------------------------------------------------- */
(function dateline() {
  const el = document.getElementById('dateline');
  if (!el) return;
  const kini = new Date();
  const hari = new Intl.DateTimeFormat('id-ID', { weekday: 'long' }).format(kini);
  const dd = String(kini.getDate()).padStart(2, '0');
  const mm = String(kini.getMonth() + 1).padStart(2, '0');
  el.textContent = `Edisi ${hari}, ${dd}.${mm}.${kini.getFullYear()}`;
})();

/* Tahun di footer */
const elTahun = document.getElementById('tahun');
if (elTahun) elTahun.textContent = String(new Date().getFullYear());

/* -------------------------------------------------------------------------
   2. Hitung bot siaran langsung (opsional) — tampil hanya kalau >= 25.
   Kalau endpoint tidak ada atau gagal, bagian kanan masthead tetap tersembunyi
   (tidak pernah menampilkan angka palsu).
   ------------------------------------------------------------------------- */
(async function botSiaran() {
  const el = document.getElementById('onair');
  if (!el) return;
  try {
    const res = await fetch('/api/publik/ringkasan', { headers: { Accept: 'application/json' }, credentials: 'same-origin' });
    if (!res.ok) return;
    const data = await res.json();
    const n = Number(data?.serverAktif ?? data?.site?.serverAktif);
    if (!Number.isFinite(n) || n < 25) return;
    el.innerHTML = html`<i></i>${n} bot <span class="hide-m">sedang </span>siaran`.s;
    el.hidden = false;
  } catch {
    /* diamkan: biarkan tersembunyi */
  }
})();

/* -------------------------------------------------------------------------
   3. Pita pengumuman dari settings.announcement
   ------------------------------------------------------------------------- */
(async function pengumuman() {
  try {
    const { site } = await api('/site');
    const teks = (site?.announcement || '').trim();
    if (!teks) return;
    const pita = document.createElement('div');
    pita.className = 'pita-kabar';
    pita.innerHTML = html`<div class="wrap"><p><b>Kabar</b> ${teks}</p><button type="button" aria-label="Tutup pengumuman"><svg class="i"><use href="#i-silang"/></svg></button></div>`.s;
    document.body.prepend(pita);
    pita.querySelector('button').addEventListener('click', () => pita.remove());
  } catch {
    /* diamkan */
  }
})();

/* -------------------------------------------------------------------------
   4. Tautan paket + status login (dipakai /harga dan tombol CTA)
   ------------------------------------------------------------------------- */
let sudahLogin = false;

function tujuanPaket(kode, login) {
  if (kode === 'uji') return login ? '/dashboard/beli?paket=uji' : '/daftar';
  const beli = `/dashboard/beli?paket=${encodeURIComponent(kode)}`;
  return login ? beli : `/daftar?next=${encodeURIComponent(beli)}`;
}

function perbaruiTautanPaket() {
  document.querySelectorAll('a[data-paket]').forEach((a) => {
    a.href = tujuanPaket(a.dataset.paket, sudahLogin);
  });
}
perbaruiTautanPaket();

/* Sudah login? Ganti Masuk/Daftar jadi satu tombol Dashboard. */
api('/auth/me')
  .then(({ user }) => {
    if (!user) return;
    sudahLogin = true;
    const aksi = document.getElementById('navAksi');
    if (aksi) aksi.innerHTML = html`<a class="btn btn-utama btn-s" href="/dashboard">Dashboard</a>`.s;
    const aksiSheet = document.getElementById('navSheetAksi');
    if (aksiSheet) aksiSheet.innerHTML = html`<a class="btn btn-utama btn-l" href="/dashboard">Buka dashboard</a>`.s;
    perbaruiTautanPaket();
  })
  .catch(() => {
    /* null/galat = belum login; biarkan apa adanya */
  });

/* -------------------------------------------------------------------------
   5. Menu seluler (sheet)
   ------------------------------------------------------------------------- */
(function menuSeluler() {
  const tombol = document.getElementById('navMenu');
  const sheet = document.getElementById('navSheet');
  const tutup = document.getElementById('navTutup');
  if (!tombol || !sheet) return;

  function buka() {
    sheet.hidden = false;
    tombol.setAttribute('aria-expanded', 'true');
    document.body.style.overflow = 'hidden';
    tutup?.focus();
  }
  function tutupMenu() {
    sheet.hidden = true;
    tombol.setAttribute('aria-expanded', 'false');
    document.body.style.overflow = '';
    tombol.focus();
  }

  tombol.addEventListener('click', buka);
  tutup?.addEventListener('click', tutupMenu);
  sheet.querySelectorAll('a').forEach((a) => a.addEventListener('click', tutupMenu));
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !sheet.hidden) tutupMenu();
  });
})();

/* -------------------------------------------------------------------------
   6. Buka otomatis item <details> kalau #id-nya dituju (deep link / nav jangkar)
   ------------------------------------------------------------------------- */
(function bukaDetailsDariHash() {
  function buka(id) {
    if (!id) return;
    let el;
    try {
      el = document.getElementById(decodeURIComponent(id));
    } catch {
      el = document.getElementById(id);
    }
    if (!el) return;
    // kalau target di dalam <details>, buka pembungkusnya juga
    const bungkus = el.closest('details');
    if (bungkus) bungkus.open = true;
    if (el.tagName === 'DETAILS') el.open = true;
    el.scrollIntoView({ block: 'start' });
  }
  buka(location.hash.slice(1));
  window.addEventListener('hashchange', () => buka(location.hash.slice(1)));
  // klik tautan jangkar di halaman yang sama -> buka <details> tujuan
  document.addEventListener('click', (e) => {
    const a = e.target.closest('a[href^="#"]');
    if (!a) return;
    const id = a.getAttribute('href').slice(1);
    if (!id) return;
    const el = document.getElementById(id);
    const bungkus = el?.closest('details') || (el?.tagName === 'DETAILS' ? el : null);
    if (bungkus) bungkus.open = true;
  });
})();

/* -------------------------------------------------------------------------
   7. Daftar harga /harga dari /api/packages
   Render hanya jika ada #daftarHarga di halaman.
   ------------------------------------------------------------------------- */
const FITUR = {
  uji: ['Semua mode JPM', 'Hingga 20 grup per putaran', '1 postingan Auto JPM tersimpan', 'Berlaku 24 jam'],
  antena: ['1 nomor WhatsApp', 'Semua mode JPM', 'Hingga 50 grup per putaran', '3 postingan Auto JPM tersimpan', '1 tugas otomatis berjalan'],
  menara: ['1 nomor WhatsApp', 'Semua mode JPM', 'Hingga 200 grup per putaran', '10 postingan Auto JPM tersimpan', '1 tugas otomatis berjalan'],
  satelit: ['1 nomor WhatsApp', 'Semua mode JPM', 'Semua grup yang kamu ikuti', '30 postingan Auto JPM tersimpan', '2 tugas otomatis sekaligus'],
};
const FITUR_UMUM = ['1 nomor WhatsApp', 'Semua mode JPM', 'Kode pairing & QR', 'Terminal langsung & whitelist'];
const TAGLINE = {
  antena: 'Pas untuk mulai jualan dan lapak dengan puluhan grup.',
  menara: 'Untuk kamu yang promosi setiap hari ke banyak grup.',
  satelit: 'Kapasitas penuh untuk jasher yang serius.',
};

function kartuTiket(p, unggulan) {
  const fitur = (FITUR[p.code] || FITUR_UMUM).map((f) => html`<li>${f}</li>`);
  const noTiket = `VJ-${String(p.days || 0).padStart(3, '0')}`;
  const cap = unggulan ? html`<div class="cap tiket-cap" aria-hidden="true">Paling<br>worth it</div>` : '';
  const taglineTeks = p.description || TAGLINE[p.code];
  const tagline = taglineTeks ? html`<p class="tiket-tagline">${taglineTeks}</p>` : '';
  const hemat = unggulan ? html` · <b style="font-weight:700">paling hemat per grup</b>` : '';
  const tombolKelas = unggulan ? 'btn-tinta' : 'btn-sekunder';
  return html`
    <article class="tiket ${unggulan ? 'tiket-unggulan' : ''}">
      <div class="tiket-badan">
        <p class="tiket-kelas"><b>${p.name}</b><span>${p.sizeLabel || ''}</span></p>
        <p class="tiket-harga"><span class="rp">Rp</span><span class="nom">${Number(p.price || 0).toLocaleString('id-ID')}</span></p>
        <p class="tiket-durasi">berlaku ${p.days || 30} hari · 1 nomor${hemat}</p>
        ${tagline}
        <ul class="tiket-fitur">${fitur}</ul>
      </div>
      <div class="sobek"></div>
      <div class="tiket-stub"><span class="tiket-no">Tiket no.<b>${noTiket}</b></span><a class="btn ${tombolKelas}" data-paket="${p.code}" href="/daftar">Pilih ${p.name}</a></div>
      ${cap}
    </article>`;
}

(async function harga() {
  const wadah = document.getElementById('daftarHarga');
  const slotTrial = document.getElementById('pitaTrial');
  if (!wadah) return;
  try {
    const { packages } = await api('/packages');
    const daftar = Array.isArray(packages) ? packages : [];

    const trial = daftar.find((p) => p.code === 'uji');
    const tiers = daftar
      .filter((p) => p.code !== 'uji')
      .sort((a, b) => (a.price || 0) - (b.price || 0));

    if (!tiers.length) {
      wadah.innerHTML = html`<p class="bantu">Belum ada paket yang dijual. Coba lagi nanti.</p>`.s;
    } else {
      wadah.innerHTML = tiers.map((p) => kartuTiket(p, p.code === 'satelit')).join('');
    }

    // Sinkronkan sel harga lain di halaman (tabel banding, teks inline) dengan API.
    const peta = Object.fromEntries(daftar.map((p) => [p.code, p.price]));
    document.querySelectorAll('[data-harga]').forEach((el) => {
      const h = peta[el.dataset.harga];
      if (h != null) el.textContent = el.dataset.harga === 'uji' ? (h ? rupiah(h) : 'Gratis') : rupiah(h);
    });

    if (slotTrial) {
      const hargaTrial = trial ? rupiah(trial.price) : 'Rp0';
      const namaTrial = trial?.name || 'Uji Sinyal';
      slotTrial.innerHTML = html`
        <div class="pita-trial">
          <span class="cap-mini kuning">Gratis</span>
          <div class="teks"><b>${namaTrial} · 24 jam (${hargaTrial})</b><p>Coba 1 server dengan semua mode JPM, hingga 20 grup per putaran dan 1 postingan Auto JPM. Berlaku sekali per akun dan sekali per nomor WhatsApp.</p></div>
          <a class="btn btn-utama" data-paket="uji" href="/daftar">Coba gratis</a>
        </div>`.s;
    }

    perbaruiTautanPaket();
  } catch {
    wadah.innerHTML = html`<p class="bantu">Harga belum bisa dimuat. Coba segarkan halaman.</p>`.s;
  }
})();

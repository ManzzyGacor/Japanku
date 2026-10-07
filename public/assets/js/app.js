import { api, html, rupiah, toast } from './lib.js';
import { ikon } from './ui.js';
import { daftarServer, detailServer, beliServer } from './views/servers.js';
import { halamanSaldo } from './views/wallet.js';
import { halamanAkun } from './views/account.js';
import { halamanAdmin } from './views/admin.js';

const view = document.getElementById('view');
const remah = document.getElementById('remah');
const relNav = document.getElementById('relNav');
const relSaldo = document.getElementById('relSaldo');
const navBawah = document.getElementById('navBawah');
const chipSaldo = document.getElementById('chipSaldo');
const avatarEl = document.getElementById('avatar');

// ---------------------------------------------------------------------------
// Menu: dipakai untuk rel samping (desktop), nav bawah (telepon) & remah
// ---------------------------------------------------------------------------
const MENU = {
  servers: { label: 'Server saya', pendek: 'Server', href: '/dashboard', ikon: 'server', hitung: true },
  buy: { label: 'Beli server', pendek: 'Beli', href: '/dashboard/beli', ikon: 'tambah' },
  wallet: { label: 'Saldo', pendek: 'Saldo', href: '/dashboard/saldo', ikon: 'dompet' },
  account: { label: 'Akun', pendek: 'Akun', href: '/dashboard/akun', ikon: 'akun' },
  admin: { label: 'Admin', pendek: 'Admin', href: '/dashboard/admin', ikon: 'perisai', admin: true },
};

// ---------------------------------------------------------------------------
// Status bersama yang dipakai semua halaman (kontrak view)
// ---------------------------------------------------------------------------
export const app = {
  user: null,
  site: {},
  _menu: 'servers',
  _judul: '',
  _jumlahServer: null,
  _saldoLama: null,

  setJudul(teks) {
    app._judul = teks;
    document.title = `${teks} — VaresaJasher`;
    gambarRemah();
  },

  async muatUlangUser() {
    const { user } = await api('/auth/me');
    if (!user) {
      keLogin();
      throw Object.assign(new Error('Sesi berakhir, silakan masuk lagi.'), { status: 401 });
    }
    app.user = user;
    gambarKerangka();
    muatJumlahServer();
    return user;
  },

  /** Navigasi SPA via History API (dipakai view untuk pindah halaman) */
  pergi(ke, opsi = {}) {
    pergi(ke, opsi);
  },

  /** Perbarui angka "Server saya" di nav (opsional dipakai view) */
  setJumlahServer(n) {
    app._jumlahServer = Number.isFinite(n) ? n : null;
    perbaruiHitung();
  },
};

// ---------------------------------------------------------------------------
// Rute berbasis History API (clean URL, tanpa #hash)
// ---------------------------------------------------------------------------
const RUTE = [
  { pola: /^\/dashboard\/?$/, tampil: daftarServer, menu: 'servers' },
  { pola: /^\/dashboard\/server\/([^/]+)\/?$/, tampil: detailServer, menu: 'servers' },
  { pola: /^\/dashboard\/beli\/?$/, tampil: beliServer, menu: 'buy' },
  { pola: /^\/dashboard\/saldo\/?$/, tampil: halamanSaldo, menu: 'wallet' },
  { pola: /^\/dashboard\/akun\/?$/, tampil: halamanAkun, menu: 'account' },
  { pola: /^\/dashboard\/admin(?:\/([a-z]+))?\/?$/, tampil: halamanAdmin, menu: 'admin', admin: true },
];

let bersihkan = null;
let nomorNavigasi = 0;

async function navigasi() {
  const jalur = location.pathname;
  const rute = RUTE.find((r) => r.pola.test(jalur));

  if (typeof bersihkan === 'function') bersihkan();
  bersihkan = null;

  if (!rute || (rute.admin && !app.user.isAdmin)) {
    pergi('/dashboard', { ganti: true });
    return;
  }

  const nomor = ++nomorNavigasi;
  const params = jalur.match(rute.pola).slice(1);

  app._menu = rute.menu;
  app._judul = MENU[rute.menu].label;
  tandaiMenu(rute.menu);
  gambarRemah();
  document.title = `${MENU[rute.menu].label} — VaresaJasher`;

  view.innerHTML = html`<div class="memuat">Memuat<span class="kursor"></span></div>`.s;
  window.scrollTo(0, 0);

  try {
    const hasil = await rute.tampil({ view, params, app, masihAktif: () => nomor === nomorNavigasi });
    if (nomor === nomorNavigasi) bersihkan = typeof hasil === 'function' ? hasil : null;
    else if (typeof hasil === 'function') hasil(); // pengguna sudah pindah halaman
  } catch (error) {
    if (error.status === 401) return keLogin();
    if (nomor !== nomorNavigasi) return;
    view.innerHTML = html`
      <section class="kosong" style="margin-top:8px">
        <h3 class="judul">Halaman gagal dimuat</h3>
        <p>${error.message}</p>
        <a class="btn btn-utama" href="/dashboard">Kembali ke server</a>
      </section>`.s;
  }
}

// ---------------------------------------------------------------------------
// Navigasi program & tangkapan klik tautan internal
// ---------------------------------------------------------------------------
function pergi(ke, { ganti = false } = {}) {
  const url = new URL(ke, location.href);
  const tujuan = url.pathname + url.search;
  const samaDenganSekarang = url.pathname === location.pathname && url.search === location.search;

  if (!samaDenganSekarang) {
    if (ganti) history.replaceState({}, '', tujuan);
    else history.pushState({}, '', tujuan);
  }
  navigasi();
}

document.addEventListener('click', (e) => {
  if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
  const a = e.target.closest('a');
  if (!a) return;
  const href = a.getAttribute('href');
  if (!href || a.target === '_blank' || a.hasAttribute('download') || a.dataset.luar != null) return;

  const url = new URL(a.href, location.href);
  if (url.origin !== location.origin) return;
  // hanya rute dasbor yang ditangani SPA; tautan lain (mis. /masuk, /harga) biar server
  if (!/^\/dashboard(\/|$)/.test(url.pathname)) return;

  e.preventDefault();
  pergi(url.pathname + url.search);
});

window.addEventListener('popstate', navigasi);

// cadangan: kalau ada kode lama yang masih memakai #hash, petakan ke clean URL
window.addEventListener('hashchange', () => {
  const peta = petakanHashLama(location.hash);
  if (peta) {
    history.replaceState({}, '', peta);
    navigasi();
  }
});

function petakanHashLama(hash) {
  if (!hash || hash === '#' || hash === '#/') return '/dashboard';
  let m;
  if (/^#\/?servers\/?$/.test(hash)) return '/dashboard';
  if ((m = hash.match(/^#\/servers\/([^/]+)/))) return `/dashboard/server/${m[1]}`;
  if (/^#\/buy/.test(hash)) return '/dashboard/beli';
  if (/^#\/wallet/.test(hash)) return '/dashboard/saldo';
  if (/^#\/account/.test(hash)) return '/dashboard/akun';
  if ((m = hash.match(/^#\/admin(?:\/([a-z]+))?/))) return `/dashboard/admin${m[1] ? '/' + m[1] : ''}`;
  return null;
}

function keLogin() {
  const next = encodeURIComponent(location.pathname + location.search);
  location.href = `/masuk?next=${next}`;
}

// ---------------------------------------------------------------------------
// Kerangka: rel samping, nav bawah, chip & avatar
// ---------------------------------------------------------------------------
function daftarMenu() {
  return Object.entries(MENU).filter(([, m]) => !m.admin || app.user.isAdmin);
}

function gambarKerangka() {
  const u = app.user;

  const menu = daftarMenu();

  // rel samping (desktop/tablet)
  relNav.innerHTML = html`${menu.map(
    ([key, m]) => html`
      <a href="${m.href}" data-menu="${key}">
        ${ikon[m.ikon]}
        <span class="rel-nav-teks">${m.label}</span>
        ${m.hitung ? html`<span class="hitung" data-hitung hidden></span>` : ''}
      </a>`,
  )}`.s;

  // nav bawah (telepon)
  navBawah.innerHTML = html`${menu.map(
    ([key, m]) => html`
      <a href="${m.href}" data-menu="${key}" class="nb-tab">
        ${ikon[m.ikon]}
        <span class="nb-label">${m.pendek}</span>
        ${m.hitung ? html`<span class="hitung" data-hitung hidden></span>` : ''}
      </a>`,
  )}`.s;
  navBawah.style.setProperty('--tab', menu.length);

  // kotak saldo di kaki rel
  relSaldo.innerHTML = html`
    <span class="kicker">Saldo</span>
    <b class="mono" data-saldo>${rupiah(u.balance)}</b>
    <a href="/dashboard/saldo">+ Isi saldo</a>`.s;

  // chip saldo + avatar di bilah atas
  chipSaldo.innerHTML = html`<span class="chip-label">Saldo</span> <b class="mono" data-saldo>${rupiah(u.balance)}</b>`.s;
  avatarEl.textContent = inisial(u.name);
  avatarEl.setAttribute('aria-label', `Akun ${u.name || ''}`.trim());

  perbaruiHitung();
  tandaiMenu(app._menu);
  perbaruiSaldo(u.balance);
}

function inisial(nama) {
  const kata = String(nama || '?').trim().split(/\s+/).filter(Boolean);
  const dua = kata.length >= 2 ? kata[0][0] + kata[1][0] : (kata[0] || '?').slice(0, 2);
  return dua.toUpperCase();
}

function perbaruiHitung() {
  const tampil = Number.isFinite(app._jumlahServer);
  document.querySelectorAll('[data-hitung]').forEach((el) => {
    el.textContent = tampil ? String(app._jumlahServer) : '';
    el.hidden = !tampil;
  });
}

function tandaiMenu(menu) {
  document.querySelectorAll('[data-menu]').forEach((a) => {
    const aktif = a.dataset.menu === menu;
    a.classList.toggle('aktif', aktif);
    if (aktif) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  });
}

function gambarRemah() {
  const m = MENU[app._menu];
  if (!m) {
    remah.innerHTML = '';
    return;
  }
  const sub = app._judul && app._judul !== m.label ? app._judul : null;
  remah.innerHTML = sub
    ? html`<a href="${m.href}">${m.label}</a> / <b>${app._judul}</b>`.s
    : html`<b>${m.label}</b>`.s;
}

function perbaruiSaldo(nilai) {
  const berubah = app._saldoLama != null && nilai !== app._saldoLama;
  document.querySelectorAll('[data-saldo]').forEach((el) => {
    el.textContent = rupiah(nilai);
  });
  if (berubah) {
    chipSaldo.classList.remove('kilat');
    void chipSaldo.offsetWidth; // paksa reflow agar animasi terulang
    chipSaldo.classList.add('kilat');
    setTimeout(() => chipSaldo.classList.remove('kilat'), 650);
  }
  app._saldoLama = nilai;
}

async function muatJumlahServer() {
  try {
    const { servers } = await api('/servers');
    app._jumlahServer = Array.isArray(servers) ? servers.length : null;
  } catch {
    app._jumlahServer = null;
  }
  perbaruiHitung();
}

// ---------------------------------------------------------------------------
// Mulai
// ---------------------------------------------------------------------------
(async () => {
  try {
    const [{ user }, { site }] = await Promise.all([api('/auth/me'), api('/site')]);
    if (!user) return keLogin();
    app.user = user;
    app.site = site || {};
  } catch (error) {
    if (error.status === 401) return keLogin();
    toast(error.message, 'error');
    return;
  }

  gambarKerangka();
  muatJumlahServer();
  navigasi();
})();

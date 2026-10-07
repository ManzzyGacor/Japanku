import { api, html, rupiah, toast } from './lib.js';
import { ikon } from './ui.js';
import { daftarServer, detailServer, beliServer } from './views/servers.js';
import { halamanSaldo } from './views/wallet.js';
import { halamanAkun } from './views/account.js';
import { halamanAdmin } from './views/admin.js';

const view = document.getElementById('view');
const judul = document.getElementById('pageTitle');
const sidebar = document.getElementById('sidebar');
const scrim = document.getElementById('scrim');
const menuBtn = document.getElementById('menuBtn');

/** Status bersama yang dipakai semua halaman */
export const app = {
  user: null,
  site: {},

  setJudul(teks) {
    judul.textContent = teks;
    document.title = `${teks} — VaresaJasher`;
  },

  async muatUlangUser() {
    const { user } = await api('/auth/me');
    if (!user) {
      keLogin();
      throw Object.assign(new Error('Sesi berakhir, silakan masuk lagi.'), { status: 401 });
    }
    app.user = user;
    gambarKerangka();
    return user;
  },
};

// ---------------------------------------------------------------------------
// Rute (berbasis #hash supaya cukup satu halaman HTML)
// ---------------------------------------------------------------------------

const RUTE = [
  { pola: /^#?\/?$/, tampil: daftarServer, menu: 'servers' },
  { pola: /^#\/servers$/, tampil: daftarServer, menu: 'servers' },
  { pola: /^#\/servers\/(\d+)$/, tampil: detailServer, menu: 'servers' },
  { pola: /^#\/buy$/, tampil: beliServer, menu: 'buy' },
  { pola: /^#\/wallet$/, tampil: halamanSaldo, menu: 'wallet' },
  { pola: /^#\/account$/, tampil: halamanAkun, menu: 'account' },
  { pola: /^#\/admin(?:\/([a-z]+))?$/, tampil: halamanAdmin, menu: 'admin', admin: true },
];

let bersihkan = null;
let nomorNavigasi = 0;

async function navigasi() {
  const hash = location.hash || '#/servers';
  const rute = RUTE.find((r) => r.pola.test(hash));

  if (typeof bersihkan === 'function') bersihkan();
  bersihkan = null;
  tutupMenu();

  if (!rute || (rute.admin && !app.user.isAdmin)) {
    location.replace('#/servers');
    return;
  }

  const nomor = ++nomorNavigasi;
  const params = hash.match(rute.pola).slice(1);
  tandaiMenu(rute.menu);
  view.innerHTML = html`<div class="loading-view"><div class="spinner"></div></div>`.s;
  window.scrollTo(0, 0);

  try {
    const hasil = await rute.tampil({ view, params, app, masihAktif: () => nomor === nomorNavigasi });
    if (nomor === nomorNavigasi) bersihkan = hasil ?? null;
    else if (typeof hasil === 'function') hasil(); // pengguna sudah pindah halaman
  } catch (error) {
    if (error.status === 401) return keLogin();
    if (nomor !== nomorNavigasi) return;
    view.innerHTML = html`
      <div class="card empty">
        <h3>Halaman gagal dimuat</h3>
        <p>${error.message}</p>
        <a class="btn btn-ghost" href="#/servers">Kembali ke server</a>
      </div>`.s;
  }
}

function keLogin() {
  location.href = `/login?next=${encodeURIComponent('/dashboard' + location.hash)}`;
}

// ---------------------------------------------------------------------------
// Sidebar & bilah atas
// ---------------------------------------------------------------------------

function gambarKerangka() {
  const u = app.user;
  document.getElementById('sideNav').innerHTML = html`
    <a href="#/servers" data-menu="servers">${ikon.server} Server saya</a>
    <a href="#/buy" data-menu="buy">${ikon.tambah} Beli server</a>
    <a href="#/wallet" data-menu="wallet">${ikon.dompet} Saldo & top up</a>
    <a href="#/account" data-menu="account">${ikon.akun} Akun</a>
    ${u.isAdmin ? html`<div class="side-label">Admin</div><a href="#/admin" data-menu="admin">${ikon.admin} Panel admin</a>` : ''}
  `.s;

  document.getElementById('sideFoot').innerHTML = html`
    <div class="side-user">
      <span class="avatar">${(u.name || '?').trim().charAt(0).toUpperCase()}</span>
      <div><b>${u.name}</b><span>${u.email}</span></div>
    </div>
    <button class="btn btn-ghost btn-sm btn-block" id="logoutBtn">${ikon.keluar} Keluar</button>
  `.s;

  document.getElementById('saldoValue').textContent = rupiah(u.balance);
  document.getElementById('logoutBtn').addEventListener('click', keluar);
  tandaiMenu(document.querySelector('.side-nav a.active')?.dataset.menu);
}

function tandaiMenu(menu) {
  document.querySelectorAll('.side-nav a').forEach((a) => {
    const aktif = a.dataset.menu === menu;
    a.classList.toggle('active', aktif);
    if (aktif) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  });
}

async function keluar() {
  try {
    await api('/auth/logout', { method: 'POST' });
  } catch {
    // tetap arahkan ke halaman login
  }
  location.href = '/login';
}

function tutupMenu() {
  sidebar.classList.remove('open');
  scrim.classList.remove('open');
  menuBtn.setAttribute('aria-expanded', 'false');
}
menuBtn.addEventListener('click', () => {
  const buka = sidebar.classList.toggle('open');
  scrim.classList.toggle('open', buka);
  menuBtn.setAttribute('aria-expanded', String(buka));
});
scrim.addEventListener('click', tutupMenu);

// ---------------------------------------------------------------------------
// Mulai
// ---------------------------------------------------------------------------

(async () => {
  try {
    const [{ user }, { site }] = await Promise.all([api('/auth/me'), api('/site')]);
    if (!user) return keLogin();
    app.user = user;
    app.site = site;
  } catch (error) {
    if (error.status === 401) return keLogin();
    toast(error.message, 'error');
    return;
  }

  gambarKerangka();
  window.addEventListener('hashchange', navigasi);
  navigasi();
})();

import { api, html, rupiah } from './lib.js';

document.getElementById('tahun').textContent = new Date().getFullYear();

// Menu untuk layar kecil -------------------------------------------------------
const navLinks = document.getElementById('navLinks');
const navToggle = document.getElementById('navToggle');
const navScrim = document.getElementById('navScrim');

function tutupNav() {
  navLinks.classList.remove('open');
  navScrim.classList.remove('open');
  navToggle.setAttribute('aria-expanded', 'false');
}
navToggle.addEventListener('click', () => {
  const buka = navLinks.classList.toggle('open');
  navScrim.classList.toggle('open', buka);
  navToggle.setAttribute('aria-expanded', String(buka));
});
navScrim.addEventListener('click', tutupNav);
navLinks.querySelectorAll('a').forEach((a) => a.addEventListener('click', tutupNav));

// Tanya jawab -------------------------------------------------------------------
document.querySelectorAll('.faq-q').forEach((q) => {
  q.addEventListener('click', () => {
    const item = q.closest('.faq-item');
    const tadinyaBuka = item.classList.contains('open');
    document.querySelectorAll('.faq-item').forEach((i) => {
      i.classList.remove('open');
      i.querySelector('.faq-q').setAttribute('aria-expanded', 'false');
    });
    if (!tadinyaBuka) {
      item.classList.add('open');
      q.setAttribute('aria-expanded', 'true');
    }
  });
});

// Sudah login? Ganti tombol Masuk/Daftar jadi Dashboard ---------------------------
api('/auth/me')
  .then(({ user }) => {
    if (!user) return;
    document.getElementById('navActions').innerHTML = html`<a class="btn btn-primary btn-sm" href="/dashboard">Dashboard</a>`.s;
  })
  .catch(() => {});

// Harga diambil dari paket yang diatur admin ---------------------------------------
(async () => {
  const wadah = document.getElementById('priceList');
  try {
    const { packages } = await api('/packages');
    if (!packages.length) {
      wadah.innerHTML = html`<article class="card price"><p class="muted">Belum ada paket yang dijual.</p></article>`.s;
      return;
    }

    // Tandai paket dengan harga per hari termurah sebagai "paling hemat"
    const hemat = packages.reduce((a, b) => (b.price / b.days < a.price / a.days ? b : a));

    wadah.innerHTML = packages
      .map(
        (p) => html`
          <article class="card price ${p.id === hemat.id && packages.length > 1 ? 'featured' : ''}">
            <div class="price-tag">${p.id === hemat.id && packages.length > 1 ? 'Paling hemat' : ''}</div>
            <h3>${p.name}</h3>
            <div class="price-amount">${rupiah(p.price)} <small>/ ${p.days} hari</small></div>
            <p>${p.description}</p>
            <ul>
              <li>1 server untuk 1 nomor</li>
              <li>JPM, JPM Tag, AutoJPM</li>
              <li>Autoreply & whitelist grup</li>
              <li>Terminal & pengaturan dari web</li>
            </ul>
            <a class="btn ${p.id === hemat.id ? 'btn-primary' : 'btn-ghost'} btn-block" href="/register">Pilih ${p.name}</a>
          </article>`.s,
      )
      .join('');
  } catch {
    wadah.innerHTML = html`<article class="card price"><p class="muted">Harga belum bisa dimuat. Coba refresh halaman.</p></article>`.s;
  }
})();

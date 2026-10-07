import path from 'path';
import fs from 'fs';
import { ROOT } from './env.js';

/*
 URL bersih tanpa .html.

 - Halaman publik punya path rapi (/harga, /faq, dst). File fisiknya tetap di public/.
 - Dashboard adalah SPA: semua /dashboard/... menyajikan dashboard.html, router di
   browser (History API) yang menentukan tampilannya.
 - Path lama (/login, /register) dan semua *.html dialihkan permanen (301) ke path
   bersih, query string selalu dibawa.
*/

export const PUBLIC = path.join(ROOT, 'public');

// path bersih -> file di public/
export const HALAMAN = {
  '/': 'index.html',
  '/harga': 'harga.html',
  '/faq': 'faq.html',
  '/panduan': 'panduan.html',
  '/syarat': 'syarat.html',
  '/privasi': 'privasi.html',
  '/masuk': 'login.html',
  '/daftar': 'register.html',
};

// file lama / path lama -> path bersih (301, query string dipertahankan)
const ALIH = {
  '/login': '/masuk',
  '/login.html': '/masuk',
  '/register': '/daftar',
  '/register.html': '/daftar',
  '/index.html': '/',
  '/harga.html': '/harga',
  '/faq.html': '/faq',
  '/panduan.html': '/panduan',
  '/syarat.html': '/syarat',
  '/privasi.html': '/privasi',
  '/dashboard.html': '/dashboard',
  '/admin': '/dashboard/admin',
  '/admin.html': '/dashboard/admin',
};

const halamanAda = (nama) => fs.existsSync(path.join(PUBLIC, nama));

/** Pasang semua rute halaman ke app Express. Dipanggil setelah /api dan sebelum static. */
export function pasangHalaman(app) {
  // Alihkan path lama -> bersih
  for (const [lama, baru] of Object.entries(ALIH)) {
    app.get(lama, (req, res) => {
      const qs = req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : '';
      res.redirect(301, baru + qs);
    });
  }

  // Halaman publik dengan path bersih. Token __BASE_URL__ (di tag canonical/og)
  // diganti alamat situs saat disajikan. Hasilnya di-cache per (berkas, asal).
  const cacheHtml = new Map();
  for (const [rute, berkas] of Object.entries(HALAMAN)) {
    if (!halamanAda(berkas)) continue;
    const lokasi = path.join(PUBLIC, berkas);
    app.get(rute, (req, res) => {
      const asal = asalSitus(req);
      const kunci = `${berkas}|${asal}`;
      let html = cacheHtml.get(kunci);
      if (html === undefined) {
        html = fs.readFileSync(lokasi, 'utf8').replaceAll('__BASE_URL__', asal);
        cacheHtml.set(kunci, html);
      }
      res.type('html').send(html);
    });
  }

  // Dashboard SPA: /dashboard dan semua turunannya -> dashboard.html
  app.get(/^\/dashboard(?:\/.*)?$/, (_req, res) => {
    res.setHeader('X-Robots-Tag', 'noindex');
    res.sendFile(path.join(PUBLIC, 'dashboard.html'));
  });

  // robots.txt & sitemap.xml
  app.get('/robots.txt', (req, res) => {
    const asal = asalSitus(req);
    res.type('text/plain').send(`User-agent: *\nDisallow: /dashboard\nDisallow: /api\n\nSitemap: ${asal}/sitemap.xml\n`);
  });

  app.get('/sitemap.xml', (req, res) => {
    const asal = asalSitus(req);
    const publik = ['/', '/harga', '/faq', '/panduan', '/syarat', '/privasi', '/daftar'].filter((r) =>
      halamanAda(HALAMAN[r] ?? ''),
    );
    const url = publik
      .map((r) => `  <url><loc>${asal}${r === '/' ? '/' : r}</loc></url>`)
      .join('\n');
    res
      .type('application/xml')
      .send(`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${url}\n</urlset>\n`);
  });
}

function asalSitus(req) {
  const env = process.env.BASE_URL;
  if (env) return env.replace(/\/+$/, '');
  return `${req.protocol}://${req.headers.host}`;
}

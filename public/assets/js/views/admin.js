import { api, html, raw, rupiah, tanggal, sisaWaktu, toast, sambilMemuat, dataForm } from '../lib.js';
import { ikon, badgeStatus, sedangJalan, konfirmasi, formDialog } from '../ui.js';
import { badgeTopup } from './wallet.js';

const TAB = [
  ['ringkasan', 'Ringkasan'],
  ['topup', 'Top up'],
  ['pengguna', 'Pengguna'],
  ['server', 'Server'],
  ['paket', 'Paket'],
  ['pengaturan', 'Pengaturan'],
];

// Tautan tab: ringkasan -> /dashboard/admin, lainnya -> /dashboard/admin/<tab>
const tautanTab = (k) => (k === 'ringkasan' ? '/dashboard/admin' : `/dashboard/admin/${k}`);

export async function halamanAdmin({ view, params, app, masihAktif }) {
  const tab = TAB.some(([k]) => k === params[0]) ? params[0] : 'ringkasan';
  app.setJudul('Panel admin');

  const { stats } = await api('/admin/stats');
  if (!masihAktif()) return undefined;

  view.innerHTML = html`<div id="halamanAdmin">
    <div class="kepala-halaman">
      <div>
        <p class="kicker">Ruang kendali</p>
        <h1>Panel admin</h1>
        <p class="sub">Kelola pengguna, top up, server, paket, dan pengaturan situs.</p>
      </div>
    </div>
    <nav class="tab-garis" aria-label="Bagian admin">
      ${TAB.map(
        ([k, label]) => html`<a href="${tautanTab(k)}" class="${k === tab ? 'aktif' : ''}" ${k === tab ? raw('aria-current="page"') : ''}>${label}${
          k === 'topup' && stats.pendingTopups ? html`<span class="hitung">${stats.pendingTopups}</span>` : ''
        }</a>`,
      )}
    </nav>
    <div id="adminBody" style="margin-top:24px"></div>
  </div>`.s;

  const body = view.querySelector('#adminBody');
  const TAMPIL = { ringkasan, topup, pengguna, server, paket, pengaturan };
  return TAMPIL[tab]({ body, stats, app, masihAktif });
}

// ---------------------------------------------------------------------------
// Ringkasan (ubin statistik §5.18)
// ---------------------------------------------------------------------------
async function ringkasan({ body, stats }) {
  const ubin = [
    ['Pengguna', stats.users, false],
    ['Total server', stats.servers, false],
    ['Server aktif', stats.activeServers, false],
    ['Terhubung nomor', stats.connectedServers, false],
    ['Bot berjalan', stats.runningBots, false],
    ['Top up menunggu', stats.pendingTopups, false],
    ['Top up bulan ini', stats.topupThisMonth, true],
    ['Penjualan bulan ini', stats.salesThisMonth, true],
  ];
  body.innerHTML = html`
    <div class="ubin">${ubin.map(
      ([k, v, uang]) => html`<div class="ubin-sel"><span class="kicker">${k}</span>${
        uang ? html`<b class="ubin-uang">${rupiah(v)}</b>` : html`<b class="ubin-angka">${v}</b>`
      }</div>`,
    )}</div>
    ${stats.pendingTopups
      ? html`<div class="catatan-peringatan" role="status" style="margin-top:20px">${ikon.peringatan}<span>Ada ${stats.pendingTopups} top up menunggu dicek. <a href="/dashboard/admin/topup" style="text-decoration:underline;text-underline-offset:3px">Buka daftar top up</a></span></div>`
      : ''}`.s;
  return undefined;
}

// ---------------------------------------------------------------------------
// Top up
// ---------------------------------------------------------------------------
async function topup({ body, app }) {
  let status = 'pending';

  const gambar = async () => {
    const { topups } = await api(`/admin/topups${status ? `?status=${status}` : ''}`);
    body.innerHTML = html`
      <section class="kartu">
        <header class="slug"><span class="slug-judul">Permintaan top up</span><span class="slug-meta">${topups.length} entri</span></header>
        <div class="kartu-isi">
          <div class="toolbar">
            <span class="kicker">Filter status</span>
            <select class="isian" id="filterStatus">
              ${[['pending', 'Menunggu'], ['approved', 'Berhasil'], ['rejected', 'Ditolak'], ['cancelled', 'Dibatalkan'], ['', 'Semua']].map(
                ([v, l]) => html`<option value="${v}" ${v === status ? raw('selected') : ''}>${l}</option>`,
              )}
            </select>
          </div>
        </div>
        ${topups.length
          ? html`<div class="tabel-gulir"><table class="tabel">
              <thead><tr><th>Tanggal</th><th>Pengguna</th><th style="text-align:right">Nominal</th><th>Metode & catatan</th><th>No.</th><th>Status</th><th></th></tr></thead>
              <tbody>${topups.map(
                (t) => html`<tr>
                  <td class="waktu">${tanggal(t.created_at, { jam: true })}</td>
                  <td class="ket">${t.user_name}<small>${t.user_email}</small></td>
                  <td class="angka">${rupiah(t.amount)}</td>
                  <td class="sembunyi-m">${t.method}${t.note ? html`<small>${t.note}</small>` : ''}</td>
                  <td class="no">#${t.id}</td>
                  <td class="status">${badgeTopup(t.status)}${t.admin_note ? html`<small style="display:block;margin-top:4px;color:var(--tinta-3)">${t.admin_note}</small>` : ''}</td>
                  <td>${t.status === 'pending'
                    ? html`<div class="aksi-baris">
                        <button class="btn btn-utama btn-s" data-setuju="${t.id}" data-info="${rupiah(t.amount)} untuk ${t.user_name}" type="button">Terima</button>
                        <button class="btn btn-bahaya btn-s" data-tolak="${t.id}" type="button">Tolak</button>
                      </div>`
                    : ''}</td>
                </tr>`,
              )}</tbody></table></div>`
          : html`<div class="kartu-isi" style="padding-top:0"><p class="catatan-mini" style="margin:0">Tidak ada data.</p></div>`}
      </section>`.s;

    body.querySelector('#filterStatus').addEventListener('change', (e) => {
      status = e.target.value;
      gambar();
    });
  };

  body.onclick = async (e) => {
    const setuju = e.target.closest('[data-setuju]');
    const tolak = e.target.closest('[data-tolak]');
    try {
      if (setuju) {
        if (!(await konfirmasi({ judul: 'Terima top up?', slug: 'Terima', pesan: `Saldo ${setuju.dataset.info} akan ditambahkan. Pastikan dana sudah masuk.`, ok: 'Terima' }))) return;
        await sambilMemuat(setuju, () => api(`/admin/topups/${setuju.dataset.setuju}/approve`, { method: 'POST' }));
        toast('Top up diterima, saldo ditambahkan.');
      } else if (tolak) {
        const data = await formDialog({
          judul: 'Tolak top up?',
          slug: 'Tolak top up',
          fields: [{ name: 'note', label: 'Alasan (dilihat pengguna)', placeholder: 'mis. dana belum masuk' }],
          ok: 'Tolak',
          bahaya: true,
        });
        if (!data) return;
        await api(`/admin/topups/${tolak.dataset.tolak}/reject`, { method: 'POST', body: data });
        toast('Top up ditolak.');
      } else return;
      await gambar();
      app.muatUlangUser().catch(() => {});
    } catch (error) {
      toast(error.message, 'error');
    }
  };

  await gambar();
  return () => {
    body.onclick = null;
  };
}

// ---------------------------------------------------------------------------
// Pengguna
// ---------------------------------------------------------------------------
async function pengguna({ body, app }) {
  let q = '';
  let jedaCari;

  body.innerHTML = html`
    <section class="kartu">
      <header class="slug"><span class="slug-judul">Pengguna</span><span class="slug-meta">kelola</span></header>
      <div class="kartu-isi">
        <div class="toolbar">
          <span class="kicker">Daftar akun</span>
          <label class="cari" style="max-width:260px">${ikon.cari}<input class="isian" id="cariUser" type="search" placeholder="Cari nama atau email"></label>
        </div>
      </div>
      <div id="tabelUser"></div>
    </section>`.s;

  const gambar = async () => {
    const { users } = await api(`/admin/users?q=${encodeURIComponent(q)}`);
    body.querySelector('#tabelUser').innerHTML = users.length
      ? html`<div class="tabel-gulir"><table class="tabel">
          <thead><tr><th>Daftar</th><th>Peran</th><th>Pengguna</th><th style="text-align:right">Saldo</th><th>Server</th><th></th></tr></thead>
          <tbody>${users.map(
            (u) => html`<tr>
              <td class="waktu">${tanggal(u.createdAt)}</td>
              <td class="status">${u.isAdmin ? html`<span class="cap-mini">Admin</span>` : html`<span class="ket">User</span>`}${u.banned ? html` <span class="cap-mini merah">Nonaktif</span>` : ''}</td>
              <td class="ket">${u.name}<small>${u.email}</small></td>
              <td class="angka">${rupiah(u.balance)}</td>
              <td class="no">${u.serverCount}</td>
              <td><div class="aksi-baris">
                <button class="btn btn-sekunder btn-s" data-saldo="${u.id}" data-nama="${u.name}" type="button">Saldo ±</button>
                ${u.id === app.user.id
                  ? ''
                  : html`
                    <button class="btn btn-hantu btn-s" data-peran="${u.id}" data-jadi="${u.isAdmin ? 'user' : 'admin'}" type="button">${u.isAdmin ? 'Cabut admin' : 'Jadikan admin'}</button>
                    <button class="btn ${u.banned ? 'btn-hantu' : 'btn-bahaya'} btn-s" data-ban="${u.id}" data-jadi="${u.banned ? '0' : '1'}" data-nama="${u.name}" type="button">${u.banned ? 'Aktifkan' : 'Nonaktifkan'}</button>`}
              </div></td>
            </tr>`,
          )}</tbody></table></div>`.s
      : html`<div class="kartu-isi" style="padding-top:0"><p class="catatan-mini" style="margin:0">Tidak ada pengguna.</p></div>`.s;
  };

  body.querySelector('#cariUser').addEventListener('input', (e) => {
    clearTimeout(jedaCari);
    jedaCari = setTimeout(() => {
      q = e.target.value.trim();
      gambar();
    }, 300);
  });

  body.onclick = async (e) => {
    const saldo = e.target.closest('[data-saldo]');
    const peran = e.target.closest('[data-peran]');
    const ban = e.target.closest('[data-ban]');
    try {
      if (saldo) {
        const data = await formDialog({
          judul: `Ubah saldo ${saldo.dataset.nama}`,
          slug: 'Ubah saldo',
          pesan: 'Angka positif menambah, negatif mengurangi. Tercatat di mutasi saldo pengguna.',
          fields: [
            { name: 'amount', label: 'Nominal (Rp)', type: 'number', placeholder: '10000 atau -5000', required: true },
            { name: 'note', label: 'Keterangan', placeholder: 'mis. bonus / koreksi' },
          ],
          validasi: (d) => (!Number.isInteger(Number(d.amount)) || Number(d.amount) === 0 ? 'Nominal harus angka bulat dan bukan 0.' : null),
        });
        if (!data) return;
        await api(`/admin/users/${saldo.dataset.saldo}/balance`, { method: 'POST', body: { amount: Number(data.amount), note: data.note } });
        toast('Saldo diperbarui.');
      } else if (peran) {
        if (!(await konfirmasi({ judul: peran.dataset.jadi === 'admin' ? 'Jadikan admin?' : 'Cabut akses admin?', slug: 'Peran', ok: 'Ya' }))) return;
        await api(`/admin/users/${peran.dataset.peran}/role`, { method: 'POST', body: { role: peran.dataset.jadi } });
        toast('Peran diperbarui. (Email di ADMIN_EMAILS tetap admin.)');
      } else if (ban) {
        const nonaktif = ban.dataset.jadi === '1';
        const ok = await konfirmasi({
          judul: nonaktif ? `Nonaktifkan ${ban.dataset.nama}?` : `Aktifkan ${ban.dataset.nama}?`,
          slug: nonaktif ? 'Nonaktifkan' : 'Aktifkan',
          pesan: nonaktif ? 'Pengguna dikeluarkan dan semua bot miliknya dimatikan.' : '',
          ok: nonaktif ? 'Nonaktifkan' : 'Aktifkan',
          bahaya: nonaktif,
        });
        if (!ok) return;
        await api(`/admin/users/${ban.dataset.ban}/ban`, { method: 'POST', body: { banned: nonaktif } });
        toast(nonaktif ? 'Pengguna dinonaktifkan.' : 'Pengguna diaktifkan.');
      } else return;
      await gambar();
      app.muatUlangUser().catch(() => {});
    } catch (error) {
      toast(error.message, 'error');
    }
  };

  await gambar();
  return () => {
    body.onclick = null;
    clearTimeout(jedaCari);
  };
}

// ---------------------------------------------------------------------------
// Server
// ---------------------------------------------------------------------------
async function server({ body, masihAktif }) {
  let q = '';
  let jedaCari;

  body.innerHTML = html`
    <section class="kartu">
      <header class="slug"><span class="slug-judul">Semua server</span><span class="slug-meta">kelola</span></header>
      <div class="kartu-isi">
        <div class="toolbar">
          <span class="kicker">Semua server</span>
          <label class="cari" style="max-width:260px">${ikon.cari}<input class="isian" id="cariServer" type="search" placeholder="Cari nama, email, atau nomor"></label>
        </div>
      </div>
      <div id="tabelServer"></div>
    </section>`.s;

  const gambar = async () => {
    const { servers } = await api(`/admin/servers?q=${encodeURIComponent(q)}`);
    if (!masihAktif()) return;
    body.querySelector('#tabelServer').innerHTML = servers.length
      ? html`<div class="tabel-gulir"><table class="tabel">
          <thead><tr><th>Aktif sampai</th><th>Status</th><th>Server</th><th style="text-align:right">Nomor</th><th>Pemilik</th><th></th></tr></thead>
          <tbody>${servers.map(
            (s) => html`<tr>
              <td class="waktu">${tanggal(s.expiresAt)}<small>${sisaWaktu(s.expiresAt)}</small></td>
              <td class="status">${badgeStatus(s)}</td>
              <td class="ket">${s.name}<small>#${s.id} · ${s.package?.name ?? '-'}</small></td>
              <td class="angka">${s.phone ?? '-'}</td>
              <td class="no">${s.owner.name}<small style="display:block;color:var(--tinta-3)">${s.owner.email}</small></td>
              <td><div class="aksi-baris">
                <button class="btn btn-sekunder btn-s" data-hari="${s.id}" data-nama="${s.name}" type="button">± Hari</button>
                ${sedangJalan(s.status)
                  ? html`<button class="btn btn-hantu btn-s" data-stop="${s.id}" type="button">Matikan</button>`
                  : s.phone && !s.expired
                    ? html`<button class="btn btn-sekunder btn-s" data-start="${s.id}" type="button">Nyalakan</button>`
                    : ''}
              </div></td>
            </tr>`,
          )}</tbody></table></div>`.s
      : html`<div class="kartu-isi" style="padding-top:0"><p class="catatan-mini" style="margin:0">Tidak ada server.</p></div>`.s;
  };

  body.querySelector('#cariServer').addEventListener('input', (e) => {
    clearTimeout(jedaCari);
    jedaCari = setTimeout(() => {
      q = e.target.value.trim();
      gambar();
    }, 300);
  });

  body.onclick = async (e) => {
    const hari = e.target.closest('[data-hari]');
    const stop = e.target.closest('[data-stop]');
    const start = e.target.closest('[data-start]');
    try {
      if (hari) {
        const data = await formDialog({
          judul: `Ubah masa aktif ${hari.dataset.nama}`,
          slug: 'Masa aktif',
          pesan: 'Angka positif menambah hari (mis. kompensasi), negatif mengurangi.',
          fields: [{ name: 'days', label: 'Jumlah hari', type: 'number', placeholder: '7 atau -3', required: true }],
          validasi: (d) => (!Number.isInteger(Number(d.days)) || Number(d.days) === 0 ? 'Isi angka bulat dan bukan 0.' : null),
        });
        if (!data) return;
        await api(`/admin/servers/${hari.dataset.hari}/extend`, { method: 'POST', body: { days: Number(data.days) } });
        toast('Masa aktif diperbarui.');
      } else if (stop) {
        if (!(await konfirmasi({ judul: 'Matikan bot ini?', slug: 'Matikan', ok: 'Matikan' }))) return;
        await sambilMemuat(stop, () => api(`/admin/servers/${stop.dataset.stop}/stop`, { method: 'POST' }));
        toast('Bot dimatikan.');
      } else if (start) {
        await sambilMemuat(start, () => api(`/admin/servers/${start.dataset.start}/start`, { method: 'POST' }));
        toast('Bot dinyalakan.');
      } else return;
      await gambar();
    } catch (error) {
      toast(error.message, 'error');
    }
  };

  await gambar();
  const pantau = setInterval(() => {
    if (!document.hidden && masihAktif()) gambar().catch(() => {});
  }, 8000);
  return () => {
    body.onclick = null;
    clearTimeout(jedaCari);
    clearInterval(pantau);
  };
}

// ---------------------------------------------------------------------------
// Paket
// ---------------------------------------------------------------------------
const fieldPaket = (p = {}) => [
  { name: 'name', label: 'Nama paket', value: p.name ?? '', placeholder: 'Menara', required: true },
  { name: 'days', label: 'Durasi (hari)', type: 'number', value: p.days ?? 30, required: true },
  { name: 'price', label: 'Harga (Rp)', type: 'number', value: p.price ?? 12000, required: true },
  { name: 'description', label: 'Deskripsi singkat', type: 'textarea', value: p.description ?? '' },
  { name: 'sort', label: 'Urutan tampil', type: 'number', value: p.sort ?? 0, hint: 'Angka kecil tampil lebih dulu.' },
  { name: 'active', label: 'Dijual (tampil di halaman harga & beli)', type: 'checkbox', value: p.active ?? 1 },
];

const rapikanPaket = (d) => ({ ...d, days: Number(d.days), price: Number(d.price), sort: Number(d.sort || 0) });

async function paket({ body }) {
  let daftar = [];

  const gambar = async () => {
    ({ packages: daftar } = await api('/admin/packages'));
    body.innerHTML = html`
      <section class="kartu">
        <header class="slug"><span class="slug-judul">Paket</span><span class="slug-meta">${daftar.length} paket</span></header>
        <div class="kartu-isi">
          <div class="toolbar">
            <span class="kicker">Katalog paket</span>
            <button class="btn btn-utama btn-s" data-tambah type="button">${ikon.tambah} Tambah paket</button>
          </div>
        </div>
        ${daftar.length
          ? html`<div class="tabel-gulir"><table class="tabel">
              <thead><tr><th>Durasi</th><th>Status</th><th>Paket</th><th style="text-align:right">Harga</th><th>Dipakai</th><th></th></tr></thead>
              <tbody>${daftar.map(
                (p) => html`<tr>
                  <td class="waktu">${p.days} hari</td>
                  <td class="status">${p.active ? html`<span class="cap-mini hijau">Dijual</span>` : html`<span class="cap-mini redup">Disembunyikan</span>`}</td>
                  <td class="ket">${p.name}${p.description ? html`<small>${p.description}</small>` : ''}</td>
                  <td class="angka">${rupiah(p.price)}</td>
                  <td class="no">${p.server_count} server</td>
                  <td><div class="aksi-baris">
                    <button class="btn btn-sekunder btn-s" data-ubah="${p.id}" type="button">Ubah</button>
                    <button class="btn btn-bahaya btn-s" data-hapus="${p.id}" data-nama="${p.name}" type="button">Hapus</button>
                  </div></td>
                </tr>`,
              )}</tbody></table></div>`
          : html`<div class="kartu-isi" style="padding-top:0"><p class="catatan-mini" style="margin:0">Belum ada paket.</p></div>`}
      </section>`.s;
  };

  body.onclick = async (e) => {
    const tambah = e.target.closest('[data-tambah]');
    const ubah = e.target.closest('[data-ubah]');
    const hapus = e.target.closest('[data-hapus]');
    try {
      if (tambah) {
        const data = await formDialog({ judul: 'Tambah paket', slug: 'Tambah paket', fields: fieldPaket() });
        if (!data) return;
        await api('/admin/packages', { method: 'POST', body: rapikanPaket(data) });
        toast('Paket ditambahkan.');
      } else if (ubah) {
        const p = daftar.find((x) => String(x.id) === ubah.dataset.ubah);
        const data = await formDialog({ judul: `Ubah paket ${p.name}`, slug: 'Ubah paket', fields: fieldPaket(p) });
        if (!data) return;
        await api(`/admin/packages/${p.id}`, { method: 'PUT', body: rapikanPaket(data) });
        toast('Paket disimpan.');
      } else if (hapus) {
        const ok = await konfirmasi({
          judul: `Hapus paket ${hapus.dataset.nama}?`,
          slug: 'Hapus paket',
          pesan: 'Kalau paket sudah dipakai server, paket hanya disembunyikan supaya riwayat tetap utuh.',
          ok: 'Hapus',
          bahaya: true,
        });
        if (!ok) return;
        const hasil = await api(`/admin/packages/${hapus.dataset.hapus}`, { method: 'DELETE' });
        toast(hasil.hidden ? 'Paket disembunyikan (masih dipakai server).' : 'Paket dihapus.');
      } else return;
      await gambar();
    } catch (error) {
      toast(error.message, 'error');
    }
  };

  await gambar();
  return () => {
    body.onclick = null;
  };
}

// ---------------------------------------------------------------------------
// Pengaturan situs
// ---------------------------------------------------------------------------
async function pengaturan({ body, app }) {
  const { settings: s } = await api('/admin/settings');

  body.innerHTML = html`
    <section class="kartu">
      <header class="slug"><span class="slug-judul">Pengaturan situs</span><span class="slug-meta">umum</span></header>
      <div class="kartu-isi">
        <form id="formSitus" novalidate>
          <div class="field">
            <label class="label" for="payment_instructions">Instruksi pembayaran</label>
            <textarea class="isian" id="payment_instructions" name="payment_instructions" maxlength="2000">${s.payment_instructions}</textarea>
            <p class="bantu">Tampil di halaman Saldo. Tulis nomor e-wallet / rekening dan atas nama.</p>
          </div>
          <div class="grid-isian">
            <div class="field">
              <label class="label" for="payment_qris_url">URL gambar QRIS <span class="opsi">opsional</span></label>
              <input class="isian" id="payment_qris_url" name="payment_qris_url" value="${s.payment_qris_url}" placeholder="https://.../qris.png">
            </div>
            <div class="field">
              <label class="label" for="min_topup">Minimal top up (Rp)</label>
              <input class="isian mono" id="min_topup" name="min_topup" type="number" min="1000" value="${s.min_topup}">
            </div>
            <div class="field">
              <label class="label" for="contact_whatsapp">WhatsApp admin <span class="opsi">opsional</span></label>
              <input class="isian mono" id="contact_whatsapp" name="contact_whatsapp" value="${s.contact_whatsapp}" placeholder="6281234567890">
            </div>
          </div>
          <div class="field">
            <label class="label" for="announcement">Pengumuman di dashboard <span class="opsi">opsional</span></label>
            <textarea class="isian" id="announcement" name="announcement" maxlength="500" style="min-height:80px" placeholder="mis. Maintenance malam ini jam 23.00">${s.announcement}</textarea>
          </div>
          <button class="btn btn-utama" type="submit" id="btnSitus">Simpan pengaturan</button>
        </form>
      </div>
    </section>`.s;

  body.querySelector('#formSitus').addEventListener('submit', async (e) => {
    e.preventDefault();
    const d = dataForm(e.target);
    try {
      await sambilMemuat(e.target.querySelector('#btnSitus'), () =>
        api('/admin/settings', { method: 'PUT', body: { ...d, min_topup: Number(d.min_topup) } }),
      );
      app.site = (await api('/site')).site;
      toast('Pengaturan situs disimpan.');
    } catch (error) {
      toast(error.message, 'error');
    }
  });
  return undefined;
}

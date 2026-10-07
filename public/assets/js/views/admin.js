import { api, html, raw, rupiah, tanggal, sisaWaktu, toast, sambilMemuat, dataForm } from '../lib.js';
import { badgeStatus, sedangJalan, konfirmasi, formDialog } from '../ui.js';
import { badgeTopup } from './wallet.js';

const TAB = [
  ['ringkasan', 'Ringkasan'],
  ['topup', 'Top up'],
  ['pengguna', 'Pengguna'],
  ['server', 'Server'],
  ['paket', 'Paket'],
  ['pengaturan', 'Pengaturan'],
];

export async function halamanAdmin({ view, params, app }) {
  const tab = TAB.some(([k]) => k === params[0]) ? params[0] : 'ringkasan';
  app.setJudul('Panel admin');

  const { stats } = await api('/admin/stats');

  view.innerHTML = html`<div id="adminPage">
    <div class="page-head"><div><h2>Panel admin</h2><p>Kelola pengguna, top up, server, paket, dan pengaturan situs.</p></div></div>
    <nav class="tabs" aria-label="Bagian admin">
      ${TAB.map(
        ([k, label]) => html`<a href="#/admin/${k}" class="${k === tab ? 'on' : ''}">${label}${
          k === 'topup' && stats.pendingTopups ? html`<span class="count">${stats.pendingTopups}</span>` : ''
        }</a>`,
      )}
    </nav>
    <div id="adminBody"></div>
  </div>`.s;

  const body = view.querySelector('#adminBody');
  const TAMPIL = { ringkasan, topup, pengguna, server, paket, pengaturan };
  return TAMPIL[tab]({ body, stats, app });
}

// ---------------------------------------------------------------------------
// Ringkasan
// ---------------------------------------------------------------------------

async function ringkasan({ body, stats }) {
  const ubin = [
    ['Pengguna', stats.users],
    ['Total server', stats.servers],
    ['Server aktif (belum habis)', stats.activeServers],
    ['Server terhubung nomor', stats.connectedServers],
    ['Bot sedang berjalan', stats.runningBots],
    ['Top up menunggu', stats.pendingTopups],
    ['Top up masuk bulan ini', rupiah(stats.topupThisMonth)],
    ['Penjualan bulan ini', rupiah(stats.salesThisMonth)],
  ];
  body.innerHTML = html`
    <div class="stats">${ubin.map(([k, v]) => html`<div class="card stat"><span>${k}</span><b>${v}</b></div>`)}</div>
    ${stats.pendingTopups
      ? html`<div class="alert alert-warn" style="margin-top:18px">Ada ${stats.pendingTopups} top up menunggu dicek. <a href="#/admin/topup">Buka daftar top up</a></div>`
      : ''}`.s;
}

// ---------------------------------------------------------------------------
// Top up
// ---------------------------------------------------------------------------

async function topup({ body, app }) {
  let status = 'pending';

  const gambar = async () => {
    const { topups } = await api(`/admin/topups${status ? `?status=${status}` : ''}`);
    body.innerHTML = html`
      <section class="card">
        <div class="toolbar">
          <h3>Permintaan top up</h3>
          <select class="select" id="statusFilter" style="max-width:220px">
            ${[['pending', 'Menunggu'], ['approved', 'Berhasil'], ['rejected', 'Ditolak'], ['cancelled', 'Dibatalkan'], ['', 'Semua']].map(
              ([v, l]) => html`<option value="${v}" ${v === status ? raw('selected') : ''}>${l}</option>`,
            )}
          </select>
        </div>
        ${topups.length
          ? html`<div class="table-wrap"><table class="table">
              <thead><tr><th>#</th><th>Pengguna</th><th>Nominal</th><th>Metode & catatan</th><th>Tanggal</th><th>Status</th><th></th></tr></thead>
              <tbody>${topups.map(
                (t) => html`<tr>
                  <td>${t.id}</td>
                  <td>${t.user_name}<small>${t.user_email}</small></td>
                  <td class="nowrap"><b>${rupiah(t.amount)}</b></td>
                  <td>${t.method}${t.note ? html`<small>${t.note}</small>` : ''}</td>
                  <td class="nowrap">${tanggal(t.created_at, { jam: true })}</td>
                  <td>${badgeTopup(t.status)}${t.admin_note ? html`<small>${t.admin_note}</small>` : ''}</td>
                  <td>${t.status === 'pending'
                    ? html`<div class="actions">
                        <button class="btn btn-success btn-sm" data-setuju="${t.id}" data-info="${rupiah(t.amount)} untuk ${t.user_name}">Terima</button>
                        <button class="btn btn-danger btn-sm" data-tolak="${t.id}">Tolak</button>
                      </div>`
                    : ''}</td>
                </tr>`,
              )}</tbody></table></div>`
          : html`<p class="muted">Tidak ada data.</p>`}
      </section>`.s;

    body.querySelector('#statusFilter').addEventListener('change', (e) => {
      status = e.target.value;
      gambar();
    });
  };

  body.onclick = async (e) => {
    const setuju = e.target.closest('[data-setuju]');
    const tolak = e.target.closest('[data-tolak]');
    try {
      if (setuju) {
        const ok = await konfirmasi({ judul: 'Terima top up?', pesan: `Saldo ${setuju.dataset.info} akan ditambahkan. Pastikan dana sudah masuk.`, ok: 'Terima' });
        if (!ok) return;
        await sambilMemuat(setuju, () => api(`/admin/topups/${setuju.dataset.setuju}/approve`, { method: 'POST' }));
        toast('Top up diterima, saldo ditambahkan.');
      } else if (tolak) {
        const data = await formDialog({
          judul: 'Tolak top up?',
          fields: [{ name: 'note', label: 'Alasan (dilihat pengguna)', placeholder: 'Misalnya: dana belum masuk' }],
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
    <section class="card">
      <div class="toolbar">
        <h3>Pengguna</h3>
        <input class="input search" id="cariUser" type="search" placeholder="Cari nama atau email">
      </div>
      <div id="userTable"></div>
    </section>`.s;

  const gambar = async () => {
    const { users } = await api(`/admin/users?q=${encodeURIComponent(q)}`);
    body.querySelector('#userTable').innerHTML = users.length
      ? html`<div class="table-wrap"><table class="table">
          <thead><tr><th>Pengguna</th><th>Saldo</th><th>Server</th><th>Peran</th><th>Daftar</th><th></th></tr></thead>
          <tbody>${users.map(
            (u) => html`<tr>
              <td>${u.name} ${u.banned ? html`<span class="badge badge-bad no-dot">Nonaktif</span>` : ''}<small>${u.email}</small></td>
              <td class="nowrap"><b>${rupiah(u.balance)}</b></td>
              <td>${u.serverCount}</td>
              <td>${u.isAdmin ? html`<span class="badge badge-info no-dot">Admin</span>` : 'User'}</td>
              <td class="nowrap">${tanggal(u.createdAt)}</td>
              <td><div class="actions">
                <button class="btn btn-soft btn-sm" data-saldo="${u.id}" data-nama="${u.name}">Saldo ±</button>
                ${u.id === app.user.id
                  ? ''
                  : html`
                    <button class="btn btn-ghost btn-sm" data-peran="${u.id}" data-jadi="${u.isAdmin ? 'user' : 'admin'}">${u.isAdmin ? 'Cabut admin' : 'Jadikan admin'}</button>
                    <button class="btn ${u.banned ? 'btn-ghost' : 'btn-danger'} btn-sm" data-ban="${u.id}" data-jadi="${u.banned ? '0' : '1'}" data-nama="${u.name}">${u.banned ? 'Aktifkan' : 'Nonaktifkan'}</button>`}
              </div></td>
            </tr>`,
          )}</tbody></table></div>`.s
      : html`<p class="muted">Tidak ada pengguna.</p>`.s;
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
          pesan: 'Isi angka positif untuk menambah, negatif untuk mengurangi. Tercatat di mutasi saldo pengguna.',
          fields: [
            { name: 'amount', label: 'Nominal (Rp)', type: 'number', placeholder: '10000 atau -5000', required: true },
            { name: 'note', label: 'Keterangan', placeholder: 'Misalnya: bonus / koreksi' },
          ],
          validasi: (d) => (!Number.isInteger(Number(d.amount)) || Number(d.amount) === 0 ? 'Nominal harus angka bulat dan bukan 0.' : null),
        });
        if (!data) return;
        await api(`/admin/users/${saldo.dataset.saldo}/balance`, { method: 'POST', body: { amount: Number(data.amount), note: data.note } });
        toast('Saldo diperbarui.');
      } else if (peran) {
        const ok = await konfirmasi({ judul: peran.dataset.jadi === 'admin' ? 'Jadikan admin?' : 'Cabut akses admin?', ok: 'Ya' });
        if (!ok) return;
        await api(`/admin/users/${peran.dataset.peran}/role`, { method: 'POST', body: { role: peran.dataset.jadi } });
        toast('Peran diperbarui. (Email di ADMIN_EMAILS tetap admin.)');
      } else if (ban) {
        const nonaktif = ban.dataset.jadi === '1';
        const ok = await konfirmasi({
          judul: nonaktif ? `Nonaktifkan ${ban.dataset.nama}?` : `Aktifkan ${ban.dataset.nama}?`,
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

async function server({ body }) {
  let q = '';
  let jedaCari;

  body.innerHTML = html`
    <section class="card">
      <div class="toolbar">
        <h3>Semua server</h3>
        <input class="input search" id="cariServer" type="search" placeholder="Cari nama, email, atau nomor">
      </div>
      <div id="serverTable"></div>
    </section>`.s;

  const gambar = async () => {
    const { servers } = await api(`/admin/servers?q=${encodeURIComponent(q)}`);
    body.querySelector('#serverTable').innerHTML = servers.length
      ? html`<div class="table-wrap"><table class="table">
          <thead><tr><th>Server</th><th>Pemilik</th><th>Nomor</th><th>Status</th><th>Aktif sampai</th><th></th></tr></thead>
          <tbody>${servers.map(
            (s) => html`<tr>
              <td>${s.name}<small>#${s.id} · ${s.package?.name ?? '-'}</small></td>
              <td>${s.owner.name}<small>${s.owner.email}</small></td>
              <td class="mono nowrap">${s.phone ?? '-'}</td>
              <td>${badgeStatus(s)}</td>
              <td class="nowrap">${tanggal(s.expiresAt)}<small>${sisaWaktu(s.expiresAt)}</small></td>
              <td><div class="actions">
                <button class="btn btn-soft btn-sm" data-hari="${s.id}" data-nama="${s.name}">± Hari</button>
                ${sedangJalan(s.status)
                  ? html`<button class="btn btn-ghost btn-sm" data-stop="${s.id}">Matikan</button>`
                  : s.phone && !s.expired
                    ? html`<button class="btn btn-ghost btn-sm" data-start="${s.id}">Nyalakan</button>`
                    : ''}
              </div></td>
            </tr>`,
          )}</tbody></table></div>`.s
      : html`<p class="muted">Tidak ada server.</p>`.s;
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
          pesan: 'Angka positif menambah hari (misalnya kompensasi), negatif mengurangi.',
          fields: [{ name: 'days', label: 'Jumlah hari', type: 'number', placeholder: '7 atau -3', required: true }],
          validasi: (d) => (!Number.isInteger(Number(d.days)) || Number(d.days) === 0 ? 'Isi angka bulat dan bukan 0.' : null),
        });
        if (!data) return;
        await api(`/admin/servers/${hari.dataset.hari}/extend`, { method: 'POST', body: { days: Number(data.days) } });
        toast('Masa aktif diperbarui.');
      } else if (stop) {
        if (!(await konfirmasi({ judul: 'Matikan bot ini?', ok: 'Matikan' }))) return;
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
    if (!document.hidden) gambar().catch(() => {});
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
  { name: 'name', label: 'Nama paket', value: p.name ?? '', placeholder: 'Bulanan', required: true },
  { name: 'days', label: 'Durasi (hari)', type: 'number', value: p.days ?? 30, required: true },
  { name: 'price', label: 'Harga (Rp)', type: 'number', value: p.price ?? 15000, required: true },
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
      <section class="card">
        <div class="toolbar">
          <h3>Paket</h3>
          <button class="btn btn-primary btn-sm" data-tambah>Tambah paket</button>
        </div>
        ${daftar.length
          ? html`<div class="table-wrap"><table class="table">
              <thead><tr><th>Paket</th><th>Durasi</th><th>Harga</th><th>Dipakai</th><th>Status</th><th></th></tr></thead>
              <tbody>${daftar.map(
                (p) => html`<tr>
                  <td>${p.name}<small>${p.description}</small></td>
                  <td class="nowrap">${p.days} hari</td>
                  <td class="nowrap"><b>${rupiah(p.price)}</b></td>
                  <td>${p.server_count} server</td>
                  <td>${p.active ? html`<span class="badge badge-online no-dot">Dijual</span>` : html`<span class="badge badge-off no-dot">Disembunyikan</span>`}</td>
                  <td><div class="actions">
                    <button class="btn btn-soft btn-sm" data-ubah="${p.id}">Ubah</button>
                    <button class="btn btn-danger btn-sm" data-hapus="${p.id}" data-nama="${p.name}">Hapus</button>
                  </div></td>
                </tr>`,
              )}</tbody></table></div>`
          : html`<p class="muted">Belum ada paket.</p>`}
      </section>`.s;
  };

  body.onclick = async (e) => {
    const tambah = e.target.closest('[data-tambah]');
    const ubah = e.target.closest('[data-ubah]');
    const hapus = e.target.closest('[data-hapus]');
    try {
      if (tambah) {
        const data = await formDialog({ judul: 'Tambah paket', fields: fieldPaket() });
        if (!data) return;
        await api('/admin/packages', { method: 'POST', body: rapikanPaket(data) });
        toast('Paket ditambahkan.');
      } else if (ubah) {
        const p = daftar.find((x) => String(x.id) === ubah.dataset.ubah);
        const data = await formDialog({ judul: `Ubah paket ${p.name}`, fields: fieldPaket(p) });
        if (!data) return;
        await api(`/admin/packages/${p.id}`, { method: 'PUT', body: rapikanPaket(data) });
        toast('Paket disimpan.');
      } else if (hapus) {
        const ok = await konfirmasi({
          judul: `Hapus paket ${hapus.dataset.nama}?`,
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
    <section class="card">
      <div class="card-title"><h3>Pengaturan situs</h3></div>
      <form id="siteForm" novalidate>
        <div class="field">
          <label for="payment_instructions">Instruksi pembayaran</label>
          <textarea class="textarea" id="payment_instructions" name="payment_instructions" rows="6" maxlength="2000">${s.payment_instructions}</textarea>
          <span class="hint">Tampil di halaman Saldo. Tulis nomor e-wallet / rekening dan atas nama.</span>
        </div>
        <div class="form-grid">
          <div class="field">
            <label for="payment_qris_url">URL gambar QRIS (opsional)</label>
            <input class="input" id="payment_qris_url" name="payment_qris_url" value="${s.payment_qris_url}" placeholder="https://.../qris.png">
          </div>
          <div class="field">
            <label for="min_topup">Minimal top up (Rp)</label>
            <input class="input" id="min_topup" name="min_topup" type="number" min="1000" value="${s.min_topup}">
          </div>
          <div class="field">
            <label for="contact_whatsapp">WhatsApp admin (opsional)</label>
            <input class="input input-mono" id="contact_whatsapp" name="contact_whatsapp" value="${s.contact_whatsapp}" placeholder="6281234567890">
          </div>
        </div>
        <div class="field">
          <label for="announcement">Pengumuman di dashboard (opsional)</label>
          <textarea class="textarea" id="announcement" name="announcement" rows="2" maxlength="500" placeholder="Misalnya: Maintenance malam ini jam 23.00">${s.announcement}</textarea>
        </div>
        <button class="btn btn-primary" type="submit" id="siteBtn">Simpan pengaturan</button>
      </form>
    </section>`.s;

  const form = body.querySelector('#siteForm');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const d = dataForm(form);
    try {
      await sambilMemuat(form.querySelector('#siteBtn'), () =>
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

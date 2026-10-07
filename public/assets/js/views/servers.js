import { api, html, raw, rupiah, tanggal, sisaWaktu, jam, toast, sambilMemuat, salin, dataForm } from '../lib.js';
import { ikon, badgeStatus, sedangJalan, konfirmasi, formDialog } from '../ui.js';

const JEDA_PANTAU = 2000;

/** Daftar perintah bot (sama dengan plugins/ di folder bot) */
const PERINTAH = [
  ['menu', 'Daftar perintah'],
  ['ping', 'Cek bot aktif'],
  ['listgc', 'Daftar grup beserta ID & nomor urutnya'],
  ['jpm <pesan>', 'Kirim ke semua grup (boleh sambil kirim gambar)'],
  ['jpmtag <pesan>', 'Seperti jpm, semua anggota ikut ditag'],
  ['autojpm', 'Simpan pesan sebelumnya lalu kirim berulang terus'],
  ['autojpm list / stop', 'Lihat daftar postingan / hentikan AutoJPM'],
  ['autoreply <pesan>', 'Balas otomatis ke grup yang sedang ramai'],
  ['whitelist', 'Grup yang dilewati jpm & autojpm'],
  ['addwhitelist 1,2,3', 'Tambah whitelist (nomor dari listgc)'],
  ['delwhitelist 1 / all', 'Hapus dari whitelist'],
  ['resetdata', 'Kosongkan data bot (sesi tetap aman)'],
];

const opsiPaket = (packages) =>
  packages.map((p) => html`<option value="${p.id}">${p.name} — ${p.days} hari — ${rupiah(p.price)}</option>`);

// ===========================================================================
// Daftar server
// ===========================================================================

export async function daftarServer({ view, app }) {
  app.setJudul('Server saya');

  const gambar = (servers) => {
    const pengumuman = app.site.announcement
      ? html`<div class="alert alert-warn announce">${app.site.announcement}</div>`
      : '';

    const isi = servers.length
      ? html`<div class="server-grid">${servers.map(
          (s) => html`
            <a class="card server-card" href="#/servers/${s.id}">
              <div class="server-card-head">
                <div>
                  <h3>${s.name}</h3>
                  ${s.phone ? html`<div class="phone">${s.phone}</div>` : html`<div class="phone none">Belum ada nomor</div>`}
                </div>
                ${badgeStatus(s)}
              </div>
              <dl class="kv">
                <div><dt>Paket</dt><dd>${s.package?.name ?? '-'}</dd></div>
                <div><dt>Aktif sampai</dt><dd>${tanggal(s.expiresAt)}</dd></div>
                <div><dt>Sisa</dt><dd>${sisaWaktu(s.expiresAt)}</dd></div>
              </dl>
              <span class="open-hint">Kelola server &rarr;</span>
            </a>`,
        )}</div>`
      : html`
          <div class="card empty">
            <div class="empty-icon">${ikon.server}</div>
            <h3>Belum punya server</h3>
            <p>Beli server pertama kamu, lalu hubungkan nomor WhatsApp untuk mulai JPM.</p>
            <a class="btn btn-primary" href="#/buy">Beli server</a>
          </div>`;

    view.innerHTML = html`
      ${pengumuman}
      <div class="page-head">
        <div>
          <h2>Server saya</h2>
          <p>1 server untuk 1 nomor WhatsApp. Butuh nomor lain? Beli server lagi.</p>
        </div>
        <div class="page-actions"><a class="btn btn-primary" href="#/buy">${ikon.tambah} Beli server</a></div>
      </div>
      ${isi}`.s;
  };

  gambar((await api('/servers')).servers);

  const timer = setInterval(async () => {
    if (document.hidden) return;
    try {
      gambar((await api('/servers')).servers);
    } catch {
      // coba lagi di putaran berikutnya
    }
  }, 5000);
  return () => clearInterval(timer);
}

// ===========================================================================
// Beli server
// ===========================================================================

export async function beliServer({ view, app }) {
  app.setJudul('Beli server');
  const [{ packages }] = await Promise.all([api('/packages'), app.muatUlangUser()]);

  if (!packages.length) {
    view.innerHTML = html`<div class="card empty"><h3>Belum ada paket</h3><p>Admin belum membuka penjualan. Coba lagi nanti.</p></div>`.s;
    return undefined;
  }

  view.innerHTML = html`
    <div class="page-head">
      <div>
        <h2>Beli server</h2>
        <p>Pilih paket. Server langsung aktif dan siap dihubungkan ke nomor WhatsApp.</p>
      </div>
    </div>
    <form class="card" id="buyForm">
      <div class="label" style="margin-bottom:12px">Paket</div>
      <div class="pkg-grid">
        ${packages.map(
          (p, i) => html`
            <label class="pkg">
              <input type="radio" name="packageId" value="${p.id}" ${i === 0 ? raw('checked') : ''}>
              <div class="pkg-body">
                <div class="pkg-name">${p.name}</div>
                <div class="pkg-price">${rupiah(p.price)} <small>/ ${p.days} hari</small></div>
                ${p.description ? html`<div class="pkg-desc">${p.description}</div>` : ''}
              </div>
            </label>`,
        )}
      </div>

      <div class="field" style="margin-top:20px; max-width:420px">
        <label for="serverName">Nama server <span class="faint">(opsional)</span></label>
        <input class="input" id="serverName" name="name" maxlength="40" placeholder="Misalnya: Jualan Akun">
      </div>

      <div class="summary" id="buySummary"></div>
      <div class="page-actions" id="buyActions"></div>
    </form>`.s;

  const form = view.querySelector('#buyForm');

  const ringkas = () => {
    const paket = packages.find((p) => String(p.id) === form.elements.packageId.value);
    const sisa = app.user.balance - paket.price;
    view.querySelector('#buySummary').innerHTML = html`
      <div><span class="muted">Harga ${paket.name} (${paket.days} hari)</span><span>${rupiah(paket.price)}</span></div>
      <div><span class="muted">Saldo kamu</span><span>${rupiah(app.user.balance)}</span></div>
      <div class="total"><span>Sisa saldo</span><span class="${sisa < 0 ? 'kurang' : ''}">${rupiah(sisa)}</span></div>`.s;
    view.querySelector('#buyActions').innerHTML = (
      sisa < 0
        ? html`<span class="muted small" style="align-self:center">Saldo belum cukup.</span><a class="btn btn-primary" href="#/wallet">Isi saldo</a>`
        : html`<button class="btn btn-primary btn-lg" type="submit" id="buyBtn">Beli server</button>`
    ).s;
  };
  // Hanya pilihan paket yang mengubah ringkasan. Jangan gambar ulang saat kolom nama
  // berubah: event "change" muncul ketika tombol Beli diklik, dan tombolnya akan
  // terganti di tengah klik.
  form.addEventListener('change', (e) => {
    if (e.target.name === 'packageId') ringkas();
  });
  ringkas();

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const data = dataForm(form);
    const paket = packages.find((p) => String(p.id) === data.packageId);
    const setuju = await konfirmasi({
      judul: 'Beli server?',
      pesan: `Paket ${paket.name} (${paket.days} hari) seharga ${rupiah(paket.price)} akan dipotong dari saldo.`,
      ok: 'Beli sekarang',
    });
    if (!setuju) return;

    try {
      const { server } = await sambilMemuat(view.querySelector('#buyBtn'), () =>
        api('/servers', { method: 'POST', body: { packageId: Number(data.packageId), name: data.name } }),
      );
      await app.muatUlangUser();
      toast('Server berhasil dibeli. Sekarang hubungkan nomor kamu.');
      location.hash = `#/servers/${server.id}`;
    } catch (error) {
      toast(error.message, 'error');
    }
  });
  return undefined;
}

// ===========================================================================
// Detail server
// ===========================================================================

export async function detailServer({ view, params, app }) {
  const id = Number(params[0]);
  let [{ server }, { packages }] = await Promise.all([api(`/servers/${id}`), api('/packages')]);
  app.setJudul(server.name);

  let metode = 'pairing';
  let kunciKoneksi = '';
  let kunciMasa = '';
  let logTerakhir = 0;
  let berhenti = false;

  view.innerHTML = html`<div id="serverPage">
    <a class="back-link" href="#/servers">${ikon.kembali} Semua server</a>
    <div class="page-head">
      <div>
        <div class="server-head"><h2 id="sName"></h2><span id="sBadge"></span></div>
        <p class="muted" id="sSub"></p>
      </div>
      <div class="page-actions"><button class="rename-btn" id="renameBtn" type="button">Ganti nama</button></div>
    </div>
    <div id="sMessage"></div>

    <div class="grid-2">
      <div class="stack">
        <section class="card" id="connCard"></section>
        <section class="card" id="expCard"></section>
      </div>
      <div class="stack">
        <section class="card">
          <div class="card-title"><h3>Terminal</h3><span class="badge no-dot">langsung</span></div>
          <div class="terminal" id="terminal" role="log" aria-live="off"><div class="ln kosong">Belum ada log. Log muncul saat bot dinyalakan.</div></div>
        </section>
        <section class="card">
          <div class="card-title"><h3>Perintah bot</h3></div>
          <p class="card-sub">Kirim dari chat WhatsApp nomor bot (misalnya ke chat diri sendiri), atau dari nomor owner tambahan. Awali dengan prefix, contoh <code>.menu</code>.</p>
          <table class="cmd-table">
            ${PERINTAH.map(([cmd, ket]) => html`<tr><td><code>${cmd}</code></td><td>${ket}</td></tr>`)}
          </table>
        </section>
      </div>
    </div>

    <section class="card" id="settingsCard" style="margin-top:18px"></section>

    <section class="card danger-zone" style="margin-top:18px">
      <div class="card-title"><h3>Hapus server</h3></div>
      <p class="card-sub">Bot dimatikan, nomor dilepas, dan semua data server (whitelist, postingan AutoJPM) dihapus. Sisa masa aktif tidak dikembalikan.</p>
      <button class="btn btn-danger" id="deleteBtn" type="button">Hapus server ini</button>
    </section>
  </div>`.s;

  // Pendengar kejadian dipasang di pembungkus halaman ini (bukan #view yang dipakai
  // bersama semua halaman), supaya ikut hilang saat pindah halaman.
  const halaman = view.querySelector('#serverPage');
  const $ = (sel) => halaman.querySelector(sel);
  const terminal = $('#terminal');

  // -------------------------------------------------------------------------
  // Kepala halaman
  // -------------------------------------------------------------------------

  function gambarKepala() {
    $('#sName').textContent = server.name;
    $('#sBadge').innerHTML = badgeStatus(server).s;
    $('#sSub').textContent = server.phone
      ? `Nomor ${server.phone} · ${server.package?.name ?? 'Tanpa paket'} · aktif sampai ${tanggal(server.expiresAt)}`
      : `${server.package?.name ?? 'Tanpa paket'} · aktif sampai ${tanggal(server.expiresAt)}`;

    const tampilPesan = server.message && server.status !== 'online';
    $('#sMessage').innerHTML = tampilPesan ? html`<div class="alert alert-warn" style="margin-bottom:18px">${server.message}</div>`.s : '';
    app.setJudul(server.name);
  }

  // -------------------------------------------------------------------------
  // Kartu koneksi (nomor WhatsApp)
  // -------------------------------------------------------------------------

  function gambarKoneksi(paksa = false) {
    const kunci = [server.phone, server.status, server.pairingCode, server.qrDataUrl, server.expired, metode].join('|');
    if (!paksa && kunci === kunciKoneksi) return;
    kunciKoneksi = kunci;

    const kartu = $('#connCard');
    const judulKartu = html`<div class="card-title"><h3>Nomor WhatsApp</h3>${badgeStatus(server)}</div>`;

    // Sudah terhubung ke nomor
    if (server.phone) {
      const jalan = sedangJalan(server.status);
      kartu.innerHTML = html`
        ${judulKartu}
        <div class="phone-big">${server.phone}</div>
        <p class="muted small">${server.lastOnlineAt ? `Terakhir online ${tanggal(server.lastOnlineAt, { jam: true })}` : 'Belum pernah online'}</p>
        ${server.expired ? html`<div class="alert alert-error" style="margin-top:14px">Masa aktif habis. Perpanjang server untuk menyalakan bot lagi.</div>` : ''}
        <div class="control-row">
          ${jalan
            ? html`<button class="btn btn-soft" data-aksi="stop" type="button">Matikan</button>
                   <button class="btn btn-soft" data-aksi="restart" type="button">Nyalakan ulang</button>`
            : html`<button class="btn btn-success" data-aksi="start" type="button" ${server.expired ? raw('disabled') : ''}>Nyalakan</button>`}
          <button class="btn btn-danger" data-aksi="logout" type="button">Lepas nomor</button>
        </div>
        <p class="hint" style="margin-top:14px">Lepas nomor = logout bot dari WhatsApp. Setelah itu server bisa dihubungkan ke nomor lain.</p>`.s;
      return;
    }

    // Masa aktif habis & belum ada nomor
    if (server.expired) {
      kartu.innerHTML = html`${judulKartu}<div class="alert alert-error">Masa aktif server habis. Perpanjang dulu untuk menghubungkan nomor.</div>`.s;
      return;
    }

    // Sedang proses login
    if (['starting', 'pairing', 'qr', 'connecting'].includes(server.status)) {
      let isi;
      if (server.pairingCode) {
        isi = html`
          <p class="card-sub">Masukkan kode ini di WhatsApp nomor <b>${server.pendingPhone}</b>.</p>
          <div class="pair-code"><b>${server.pairingCode}</b><button class="btn btn-soft btn-sm" data-copy type="button">Salin</button></div>
          <ol class="steps-list">
            <li><span>Buka <b>WhatsApp</b> di HP nomor tersebut.</span></li>
            <li><span>Ketuk <b>&#8942;</b> atau <b>Setelan</b>, lalu <b>Perangkat tertaut</b> &rsaquo; <b>Tautkan perangkat</b>.</span></li>
            <li><span>Pilih <b>Tautkan dengan nomor telepon saja</b>, lalu ketik kode di atas.</span></li>
          </ol>`;
      } else if (server.qrDataUrl) {
        isi = html`
          <p class="card-sub">Scan QR ini dari WhatsApp di HP yang nomornya mau dijadikan bot.</p>
          <div class="qr-box"><img src="${server.qrDataUrl}" alt="QR code login WhatsApp" width="240" height="240"></div>
          <ol class="steps-list">
            <li><span>Buka <b>WhatsApp</b> &rsaquo; <b>Perangkat tertaut</b> &rsaquo; <b>Tautkan perangkat</b>.</span></li>
            <li><span>Arahkan kamera ke QR di atas. QR berganti otomatis kalau kedaluwarsa.</span></li>
          </ol>`;
      } else {
        isi = html`<div class="waiting"><div class="spinner"></div><span>${server.method === 'qr' ? 'Menyiapkan QR code ...' : 'Menyiapkan kode pairing ...'}</span></div>`;
      }

      kartu.innerHTML = html`
        ${judulKartu}
        ${isi}
        <p class="hint" style="margin-bottom:14px">Halaman ini berubah otomatis setelah nomor tersambung.</p>
        <button class="btn btn-ghost btn-sm" data-aksi="cancel" type="button">Batalkan</button>`.s;
      return;
    }

    // Belum terhubung -> form hubungkan
    kartu.innerHTML = html`
      ${judulKartu}
      <p class="card-sub">Hubungkan nomor yang mau dijadikan bot. Sebaiknya pakai nomor cadangan khusus jualan.</p>
      <div class="method-toggle" role="group" aria-label="Cara menghubungkan">
        <button type="button" data-metode="pairing" class="${metode === 'pairing' ? 'on' : ''}" aria-pressed="${metode === 'pairing'}">Pairing code</button>
        <button type="button" data-metode="qr" class="${metode === 'qr' ? 'on' : ''}" aria-pressed="${metode === 'qr'}">Scan QR</button>
      </div>
      <form id="connectForm" novalidate>
        ${metode === 'pairing'
          ? html`
            <div class="field">
              <label for="phoneInput">Nomor WhatsApp</label>
              <input class="input input-mono" id="phoneInput" name="phone" inputmode="numeric" autocomplete="tel" placeholder="6281234567890" required>
              <span class="hint">Pakai kode negara tanpa tanda +. Awalan 0 otomatis diganti 62.</span>
            </div>`
          : html`<p class="hint" style="margin-bottom:16px">QR muncul di sini setelah kamu menekan tombol. Siapkan HP yang nomornya mau dijadikan bot.</p>`}
        <button class="btn btn-primary btn-block" type="submit" id="connectBtn">${metode === 'pairing' ? 'Dapatkan kode pairing' : 'Tampilkan QR'}</button>
      </form>`.s;
  }

  // -------------------------------------------------------------------------
  // Kartu masa aktif
  // -------------------------------------------------------------------------

  function gambarMasa() {
    const kunci = `${server.expiresAt}|${server.package?.id}`;
    if (kunci === kunciMasa) return;
    kunciMasa = kunci;

    $('#expCard').innerHTML = html`
      <div class="card-title"><h3>Masa aktif</h3>${server.expired ? html`<span class="badge badge-bad">Habis</span>` : ''}</div>
      <dl class="kv">
        <div><dt>Paket</dt><dd>${server.package?.name ?? '-'}</dd></div>
        <div><dt>Aktif sampai</dt><dd>${tanggal(server.expiresAt, { jam: true })}</dd></div>
        <div><dt>Sisa</dt><dd>${sisaWaktu(server.expiresAt)}</dd></div>
      </dl>
      ${packages.length
        ? html`
          <form id="renewForm" style="margin-top:18px">
            <label class="label" for="renewPkg">Perpanjang</label>
            <div class="input-group" style="margin-top:7px">
              <select class="select" id="renewPkg" name="packageId">${opsiPaket(packages)}</select>
              <button class="btn btn-soft" type="submit" id="renewBtn">Perpanjang</button>
            </div>
          </form>`
        : ''}`.s;
  }

  // -------------------------------------------------------------------------
  // Kartu pengaturan
  // -------------------------------------------------------------------------

  function gambarPengaturan() {
    const s = server.settings;
    $('#settingsCard').innerHTML = html`
      <div class="card-title"><h3>Pengaturan bot</h3></div>
      <p class="card-sub">Pengganti file config.js. Kalau bot sedang jalan, bot dinyalakan ulang otomatis setelah disimpan.</p>
      <form id="settingsForm" class="form-grid" novalidate>
        <div class="field">
          <label for="namaBot">Nama bot</label>
          <input class="input" id="namaBot" name="namaBot" maxlength="40" value="${s.namaBot}" required>
          <span class="hint">Muncul di menu & ping.</span>
        </div>
        <div class="field">
          <label for="prefix">Prefix perintah</label>
          <input class="input input-mono" id="prefix" name="prefix" maxlength="10" value="${s.prefix.join(' ')}" required>
          <span class="hint">1-5 simbol, pisahkan dengan spasi. Contoh: <code>. #</code></span>
        </div>
        <div class="field">
          <label for="jedaKirim">Jeda kirim (detik)</label>
          <input class="input" id="jedaKirim" name="jedaKirim" type="number" min="5" max="600" value="${s.jedaKirim}" required>
          <span class="hint">Jeda antar grup/kontak. Makin besar makin aman dari banned. Minimal 5.</span>
        </div>
        <div class="field">
          <label for="jedaPutaran">Jeda putaran AutoJPM (detik)</label>
          <input class="input" id="jedaPutaran" name="jedaPutaran" type="number" min="60" max="86400" value="${s.autojpm.jedaPutaran}" required>
          <span class="hint" id="jedaPutaranInfo"></span>
        </div>
        <div class="field">
          <label for="mode">Mode</label>
          <select class="select" id="mode" name="mode">
            <option value="production" ${s.mode === 'production' ? raw('selected') : ''}>Normal — pesan benar-benar dikirim</option>
            <option value="development" ${s.mode === 'development' ? raw('selected') : ''}>Uji coba — pesan massal tidak dikirim</option>
          </select>
          <span class="hint">Mode uji coba hanya mencatat ke terminal, cocok untuk mencoba alurnya.</span>
        </div>
        <div class="field">
          <label for="nomorOwner">Owner tambahan</label>
          <input class="input input-mono" id="nomorOwner" name="nomorOwner" value="${s.nomorOwner.join(', ')}" placeholder="628111, 628222">
          <span class="hint">Nomor lain yang boleh menyuruh bot. Pisahkan dengan koma. Nomor bot sendiri selalu boleh.</span>
        </div>
        <div class="field full">
          <label class="check"><input type="checkbox" name="tagSemua" ${s.autojpm.tagSemua ? raw('checked') : ''}><span>AutoJPM ikut tag semua anggota grup</span></label>
        </div>
        <div class="full"><button class="btn btn-primary" type="submit" id="settingsBtn">Simpan pengaturan</button></div>
      </form>`.s;

    const info = () => {
      const detik = Number($('#jedaPutaran').value) || 0;
      $('#jedaPutaranInfo').textContent = `Sekitar ${Math.round(detik / 60)} menit. Waktu tunggu sebelum AutoJPM mengulang.`;
    };
    $('#jedaPutaran').addEventListener('input', info);
    info();
  }

  // -------------------------------------------------------------------------
  // Terminal
  // -------------------------------------------------------------------------

  async function muatLog() {
    const { logs } = await api(`/servers/${id}/logs?after=${logTerakhir}`);
    if (!logs.length) return;

    const dekatBawah = terminal.scrollHeight - terminal.scrollTop - terminal.clientHeight < 40;
    if (logTerakhir === 0) terminal.innerHTML = '';

    terminal.insertAdjacentHTML(
      'beforeend',
      logs.map((l) => html`<div class="ln"><span class="t">${jam(l.ts)}</span><span class="${l.level}">${l.text}</span></div>`.s).join(''),
    );
    while (terminal.childElementCount > 400) terminal.firstElementChild.remove();
    logTerakhir = logs[logs.length - 1].id;
    if (dekatBawah) terminal.scrollTop = terminal.scrollHeight;
  }

  // -------------------------------------------------------------------------
  // Gambar semua & pantau
  // -------------------------------------------------------------------------

  function gambarSemua(paksa = false) {
    gambarKepala();
    gambarKoneksi(paksa);
    gambarMasa();
  }

  gambarSemua(true);
  gambarPengaturan();
  await muatLog().catch(() => {});
  terminal.scrollTop = terminal.scrollHeight;

  const pantau = setInterval(async () => {
    if (document.hidden || berhenti) return;
    try {
      const tadinyaTanpaNomor = !server.phone;
      ({ server } = await api(`/servers/${id}`));
      if (berhenti) return;
      gambarSemua();
      if (tadinyaTanpaNomor && server.phone) toast(`Nomor ${server.phone} berhasil terhubung!`);
      await muatLog();
    } catch (error) {
      if (error.status === 404) {
        berhenti = true;
        location.hash = '#/servers';
      }
    }
  }, JEDA_PANTAU);

  // -------------------------------------------------------------------------
  // Aksi
  // -------------------------------------------------------------------------

  async function jalankan(tombol, path, body) {
    try {
      const hasil = await sambilMemuat(tombol, () => api(`/servers/${id}${path}`, { method: 'POST', body }));
      if (hasil.server) server = hasil.server;
      gambarSemua(true);
      muatLog().catch(() => {});
      return hasil;
    } catch (error) {
      toast(error.message, 'error');
      return null;
    }
  }

  halaman.addEventListener('click', async (e) => {
    const metodeBtn = e.target.closest('[data-metode]');
    if (metodeBtn) {
      metode = metodeBtn.dataset.metode;
      gambarKoneksi(true);
      return;
    }

    if (e.target.closest('[data-copy]')) {
      salin(server.pairingCode.replace(/-/g, ''));
      return;
    }

    const tombol = e.target.closest('[data-aksi]');
    if (!tombol) return;
    const aksi = tombol.dataset.aksi;

    if (aksi === 'start') await jalankan(tombol, '/start');
    if (aksi === 'restart') await jalankan(tombol, '/restart');
    if (aksi === 'cancel') await jalankan(tombol, '/cancel');
    if (aksi === 'stop') {
      const ok = await konfirmasi({ judul: 'Matikan bot?', pesan: 'AutoJPM dan autoreply yang sedang berjalan ikut berhenti.', ok: 'Matikan' });
      if (ok) await jalankan(tombol, '/stop');
    }
    if (aksi === 'logout') {
      const ok = await konfirmasi({
        judul: 'Lepas nomor dari server?',
        pesan: `Bot logout dari WhatsApp nomor ${server.phone} dan sesinya dihapus. Kamu perlu pairing ulang untuk memakainya lagi.\n\nKalau bot sedang mati, hapus juga perangkat tertaut di HP kamu secara manual.`,
        ok: 'Lepas nomor',
        bahaya: true,
      });
      if (ok && (await jalankan(tombol, '/logout'))) toast('Nomor dilepas. Server siap dihubungkan ke nomor lain.');
    }
  });

  halaman.addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = e.target;

    if (form.id === 'connectForm') {
      const body = { method: metode };
      if (metode === 'pairing') {
        body.phone = form.elements.phone.value.trim();
        if (!body.phone) return toast('Isi nomor WhatsApp dulu.', 'error');
      }
      await jalankan(form.querySelector('#connectBtn'), '/connect', body);
    }

    if (form.id === 'renewForm') {
      const paket = packages.find((p) => String(p.id) === form.elements.packageId.value);
      const ok = await konfirmasi({
        judul: `Perpanjang ${paket.days} hari?`,
        pesan: `Paket ${paket.name} seharga ${rupiah(paket.price)} dipotong dari saldo (saldo kamu ${rupiah(app.user.balance)}).`,
        ok: 'Perpanjang',
      });
      if (!ok) return;
      const hasil = await jalankan(form.querySelector('#renewBtn'), '/renew', { packageId: paket.id });
      if (hasil) {
        toast(hasil.message);
        app.muatUlangUser().catch(() => {});
      }
    }

    if (form.id === 'settingsForm') {
      const d = dataForm(form);
      try {
        const hasil = await sambilMemuat(form.querySelector('#settingsBtn'), () =>
          api(`/servers/${id}/settings`, {
            method: 'PUT',
            body: {
              namaBot: d.namaBot,
              prefix: d.prefix,
              jedaKirim: Number(d.jedaKirim),
              autojpm: { jedaPutaran: Number(d.jedaPutaran), tagSemua: form.elements.tagSemua.checked },
              mode: d.mode,
              nomorOwner: d.nomorOwner,
            },
          }),
        );
        server = hasil.server;
        gambarSemua(true);
        gambarPengaturan();
        toast(hasil.message);
      } catch (error) {
        toast(error.message, 'error');
      }
    }
  });

  $('#renameBtn').addEventListener('click', async () => {
    const data = await formDialog({
      judul: 'Ganti nama server',
      fields: [{ name: 'name', label: 'Nama server', value: server.name, required: true }],
    });
    if (!data) return;
    try {
      ({ server } = await api(`/servers/${id}`, { method: 'PATCH', body: data }));
      gambarSemua(true);
      toast('Nama server diganti.');
    } catch (error) {
      toast(error.message, 'error');
    }
  });

  $('#deleteBtn').addEventListener('click', async () => {
    const data = await formDialog({
      judul: 'Hapus server?',
      pesan: `Tindakan ini tidak bisa dibatalkan. Ketik nama server "${server.name}" untuk konfirmasi.`,
      fields: [{ name: 'confirm', label: 'Nama server', placeholder: server.name, required: true }],
      ok: 'Hapus permanen',
      bahaya: true,
      validasi: (d) => (d.confirm !== server.name ? 'Nama server belum sama.' : null),
    });
    if (!data) return;
    try {
      berhenti = true;
      await api(`/servers/${id}`, { method: 'DELETE', body: data });
      toast('Server dihapus.');
      location.hash = '#/servers';
    } catch (error) {
      berhenti = false;
      toast(error.message, 'error');
    }
  });

  return () => {
    berhenti = true;
    clearInterval(pantau);
  };
}

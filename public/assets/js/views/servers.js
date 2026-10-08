import { api, html, raw, rupiah, tanggal, sisaWaktu, jam, toast, sambilMemuat, salin, dataForm } from '../lib.js';
import { ikon, badgeStatus, sedangJalan, konfirmasi, formDialog } from '../ui.js';
import { kirimTagihan } from './invoice.js';

/** Nominal minimum gateway QRIS (dari /api/site). */
const minQris = (app) => Math.max(app.site?.qris?.minAmount || 1000, 1000);

const JEDA_PANTAU = 2000; // detail server
const JEDA_DAFTAR = 5000; // daftar server
const BERLAKU_KODE = 60; // detik — kode pairing WhatsApp kira-kira 60 dtk lalu berganti

// Perintah bot yang benar-benar ada (lihat plugins/ di folder bot). Tanpa push kontak.
const PERINTAH = [
  ['.menu', 'Tampilkan daftar perintah bot.'],
  ['.ping', 'Cek bot masih hidup.'],
  ['.listgc', 'Daftar grup beserta nomor urut untuk whitelist.'],
  ['.jpm', 'Kirim pesan sekali ke semua grup (bisa sambil kirim gambar).'],
  ['.jpmtag', 'Seperti .jpm, tapi semua anggota ikut ter-tag diam-diam.'],
  ['.autojpm', 'Simpan pesan lalu kirim ulang otomatis tiap jeda.'],
  ['.autoreply', 'Balas otomatis grup yang sedang ramai.'],
  ['.whitelist', 'Lihat grup yang dilewati .jpm & .autojpm.'],
  ['.addwhitelist', 'Tambah grup ke whitelist (pakai nomor dari .listgc).'],
  ['.delwhitelist', 'Hapus grup dari whitelist (atau all).'],
  ['.resetdata', 'Kosongkan data bot. Sesi WhatsApp tetap aman.'],
];

const hargaAngka = (n) => rupiah(n).replace(/^Rp/, '');
const opsiPaket = (packages) =>
  packages.map((p) => html`<option value="${p.id}">${p.name} — ${p.days} hari — ${rupiah(p.price)}</option>`);

/** Lencana server, tapi tidak melebar di dalam kolom (dibungkus div). */
const lencana = (s) => html`<div>${badgeStatus(s)}</div>`;

// ===========================================================================
// 5.8 — Daftar server ("Server saya")
// ===========================================================================

export async function daftarServer({ view, app, masihAktif }) {
  app.setJudul('Server saya');

  const kartuServer = (s, i) => {
    const hariSisa = Math.floor((s.expiresAt - Date.now()) / 86400000);
    const segera = !s.expired && hariSisa <= 3;
    return html`
      <div class="kartu kartu-server">
        <a class="regang-tautan" href="/dashboard/server/${s.id}" aria-label="Buka ${s.name}"></a>
        <header class="slug">
          <span class="slug-judul">Server ${raw(String(i + 1).padStart(2, '0'))}</span>
          <span class="slug-meta">${s.package?.name ?? 'Tanpa paket'}</span>
        </header>
        <div class="kartu-isi">
          <div class="kartu-server-nama">${s.name}</div>
          ${s.phone
            ? html`<div class="kartu-server-telepon mono">${s.phone}</div>`
            : html`<div class="kartu-server-telepon kosong">Belum ada nomor</div>`}
          ${lencana(s)}
          <div class="kartu-server-jpm kosong">Belum ada JPM berjalan.</div>
          <div class="kartu-server-kaki">
            <span class="${raw(segera ? 'segera' : '')}">${
              s.expired ? 'Masa aktif habis' : html`Aktif s/d ${tanggal(s.expiresAt)} · ${sisaWaktu(s.expiresAt)}`
            }</span>
            ${segera || s.expired
              ? html`<a class="btn btn-sekunder btn-s di-atas" href="/dashboard/server/${s.id}">Perpanjang</a>`
              : ''}
            <span class="panah" aria-hidden="true">${ikon.panah}</span>
          </div>
        </div>
      </div>`;
  };

  const gambar = (servers) => {
    if (!masihAktif()) return;
    app.setJumlahServer(servers.length);

    const pengumuman = app.site?.announcement
      ? html`<div class="catatan-peringatan" role="status" style="margin-bottom:24px">${ikon.info}<span>${app.site.announcement}</span></div>`
      : '';

    const isi = servers.length
      ? html`<div class="server-grid">
          ${servers.map(kartuServer)}
          <a class="kartu-tambah" href="/dashboard/beli">${ikon.tambah}<span>Tambah server</span></a>
        </div>`
      : html`<div class="kosong">
          <h3>Belum ada server</h3>
          <p>Coba dulu gratis 24 jam, atau beli server lalu tautkan nomor WhatsApp untuk mulai siaran JPM.</p>
          <a class="btn btn-utama" href="/dashboard/beli">${ikon.tambah} Coba gratis / beli server</a>
        </div>`;

    view.innerHTML = html`
      ${pengumuman}
      <div class="kepala-halaman">
        <div>
          <p class="kicker">Meja siaran</p>
          <h1>Server saya</h1>
          <p class="sub">1 server untuk 1 nomor WhatsApp. Butuh nomor lain? Beli server lagi.</p>
        </div>
        <div class="aksi"><a class="btn btn-utama" href="/dashboard/beli">${ikon.tambah} Beli server</a></div>
      </div>
      ${isi}`.s;
  };

  gambar((await api('/servers')).servers);

  const timer = setInterval(async () => {
    if (document.hidden || !masihAktif()) return;
    try {
      gambar((await api('/servers')).servers);
    } catch {
      /* coba lagi putaran berikutnya */
    }
  }, JEDA_DAFTAR);
  return () => clearInterval(timer);
}

// ===========================================================================
// Beli server (pemilih paket tiket, §5.21)
// ===========================================================================

/** Ambil status trial (aman kalau endpoint gagal). */
async function statusTrial() {
  try {
    return await api('/trial/status');
  } catch {
    return { enabled: false, eligible: { boleh: false } };
  }
}

/** Klaim free trial lalu buka server barunya. Dipakai tombol "Coba gratis". */
async function klaimTrial(app, tombol) {
  try {
    const { server } = await sambilMemuat(tombol, () => api('/trial/claim', { method: 'POST' }));
    await app.muatUlangUser().catch(() => {});
    toast('Server Uji Sinyal dibuat. Tautkan nomor untuk mulai.', 'ok', { kicker: 'Free trial' });
    app.pergi(`/dashboard/server/${server.id}`);
  } catch (error) {
    toast(error.message, 'error');
  }
}

/** Banner ajakan trial (hanya ditampilkan kalau layak). */
function bannerTrial(trial) {
  if (!trial?.enabled || !trial?.eligible?.boleh) return '';
  return html`<div class="kartu kartu-trial" style="margin-bottom:18px">
    <div class="kartu-isi" style="display:flex;flex-wrap:wrap;align-items:center;gap:14px;justify-content:space-between">
      <div>
        <p class="kicker" style="color:var(--hijau)">Gratis · Uji Sinyal</p>
        <b style="font-size:18px">Coba dulu gratis 24 jam</b>
        <p class="bantu" style="margin-top:4px">1 server, semua mode JPM, tanpa bayar. Berlaku sekali per akun & per nomor WhatsApp.</p>
      </div>
      <button class="btn btn-utama" type="button" id="btnTrial">${ikon.tambah} Coba gratis 24 jam</button>
    </div>
  </div>`;
}

export async function beliServer({ view, app }) {
  app.setJudul('Beli server');
  const [{ packages }, trial] = await Promise.all([api('/packages'), statusTrial(), app.muatUlangUser()]);

  if (!packages.length) {
    view.innerHTML = html`
      <div class="kepala-halaman"><div><p class="kicker">Tiket siaran</p><h1>Beli server</h1></div></div>
      <div class="kosong"><h3>Belum ada paket</h3><p>Admin belum membuka penjualan. Coba lagi nanti.</p></div>`.s;
    return undefined;
  }

  view.innerHTML = html`
    <div class="kepala-halaman">
      <div>
        <p class="kicker">Tiket siaran</p>
        <h1>Beli server</h1>
        <p class="sub">Pilih paket. Server langsung aktif dan siap ditautkan ke nomor WhatsApp.</p>
      </div>
    </div>
    ${bannerTrial(trial)}
    <form class="kartu" id="formBeli">
      <header class="slug"><span class="slug-judul">Pilih paket</span><span class="slug-meta">1 server = 1 nomor</span></header>
      <div class="kartu-isi">
        <fieldset style="border:0">
          <legend class="label">Paket</legend>
          <div class="paket-grid">
            ${packages.map(
              (p, i) => html`
                <label class="paket">
                  <input type="radio" name="packageId" value="${p.id}" ${i === 0 ? raw('checked') : ''}>
                  <span>
                    <span class="paket-kelas"><span>${p.name}</span><span>${p.sizeLabel ?? ''}</span></span>
                    <span class="paket-harga"><span class="rp">Rp</span>${hargaAngka(p.price)}</span>
                    <span class="paket-durasi">berlaku ${p.days} hari · 1 nomor</span>
                  </span>
                </label>`,
            )}
          </div>
        </fieldset>

        <div class="field" style="margin-top:20px;max-width:420px">
          <label class="label" for="serverName">Nama server <span class="opsi">opsional · hanya untuk kamu</span></label>
          <input class="isian" id="serverName" name="name" maxlength="40" placeholder="Misalnya: Jualan Akun">
        </div>

        <dl class="ringkasan" id="beliRingkas"></dl>
        <div class="aksi-jpm" id="beliAksi"></div>
      </div>
    </form>`.s;

  view.querySelector('#btnTrial')?.addEventListener('click', (e) => klaimTrial(app, e.currentTarget));

  const form = view.querySelector('#formBeli');

  const ringkas = () => {
    const paket = packages.find((p) => String(p.id) === form.elements.packageId.value) ?? packages[0];
    const sisa = app.user.balance - paket.price;
    const kurang = sisa < 0;
    form.querySelector('#beliRingkas').innerHTML = html`
      <div><dt>Harga ${paket.name} (${paket.days} hari)</dt><dd>${rupiah(paket.price)}</dd></div>
      <div><dt>Saldo kamu</dt><dd>${rupiah(app.user.balance)}</dd></div>
      <div class="total ${raw(kurang ? 'kurang' : '')}"><dt>Sisa saldo</dt><dd>${rupiah(sisa)}</dd></div>`.s;
    const qrisAktif = !!app.site?.qris?.enabled;
    const bayarQris = Math.max(paket.price - app.user.balance, minQris(app));
    form.querySelector('#beliAksi').innerHTML = (
      kurang
        ? html`<div class="catatan-peringatan" role="alert" style="flex:1 1 100%">${ikon.peringatan}<span>Saldo kurang ${rupiah(-sisa)}. Isi saldo dulu${qrisAktif ? ', atau bayar paket ini lewat QRIS' : ' untuk membeli paket ini'}.</span></div>
               <a class="btn btn-sekunder" href="/dashboard/saldo">${ikon.dompet} Isi saldo</a>
               ${qrisAktif ? html`<button class="btn btn-utama" type="button" id="btnQrisBeli">Bayar ${rupiah(bayarQris)} lewat QRIS ${ikon.panah}</button>` : ''}`
        : html`<button class="btn btn-utama btn-l" type="submit" id="btnBeli">Bayar ${rupiah(paket.price)} dari saldo ${ikon.panah}</button>`
    ).s;
  };
  // Hanya pilihan paket yang mengubah ringkasan; jangan gambar ulang saat kolom nama
  // berubah (event "change" juga muncul saat tombol Beli diklik -> tombol terganti).
  form.addEventListener('change', (e) => {
    if (e.target.name === 'packageId') ringkas();
  });
  ringkas();

  // Bayar lewat QRIS saat saldo kurang (tombol muncul di branch "kurang").
  form.addEventListener('click', async (e) => {
    const btn = e.target.closest('#btnQrisBeli');
    if (!btn) return;
    const data = dataForm(form);
    const paket = packages.find((p) => String(p.id) === data.packageId);
    if (!paket) return;
    try {
      const { invoice } = await sambilMemuat(btn, () =>
        kirimTagihan('/payment/buy', { body: { packageId: Number(data.packageId), name: data.name } }),
      );
      app.pergi(`/dashboard/invoice/${invoice.orderId}`);
    } catch (error) {
      if (error.code === 'SALDO_CUKUP') {
        toast('Saldo kamu ternyata cukup, beli langsung pakai saldo.', 'info');
        await app.muatUlangUser().catch(() => {});
        ringkas();
      } else if (error.code === 'PENDING_EXISTS' && error.orderId) {
        app.pergi(`/dashboard/invoice/${error.orderId}`);
      } else {
        toast(error.message, 'error');
      }
    }
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const data = dataForm(form);
    const paket = packages.find((p) => String(p.id) === data.packageId);
    if (!paket || app.user.balance < paket.price) return;
    const setuju = await konfirmasi({
      judul: 'Beli server?',
      slug: 'Beli server',
      pesan: `Paket ${paket.name} (${paket.days} hari) seharga ${rupiah(paket.price)} dipotong dari saldo.`,
      ok: 'Beli sekarang',
    });
    if (!setuju) return;
    try {
      const { server } = await sambilMemuat(form.querySelector('#btnBeli'), () =>
        api('/servers', { method: 'POST', body: { packageId: Number(data.packageId), name: data.name } }),
      );
      await app.muatUlangUser();
      toast('Server dibeli. Sekarang tautkan nomor kamu.', 'ok', { kicker: 'Server baru' });
      app.pergi(`/dashboard/server/${server.id}`);
    } catch (error) {
      toast(error.message, 'error');
    }
  });
  return undefined;
}

// ===========================================================================
// 5.9/5.7 — Detail server
// ===========================================================================

export async function detailServer({ view, params, app, masihAktif }) {
  const id = Number(params[0]);
  let [{ server }, { packages }] = await Promise.all([api(`/servers/${id}`), api('/packages')]);
  app.setJudul(server.name);

  // Pairing: metode awal (telepon tidak bisa scan layarnya sendiri -> KODE di telepon,
  // SCAN QR di desktop). Dipakai hanya di tahap "form sambung".
  let metode = window.matchMedia('(min-width: 761px)').matches ? 'qr' : 'pairing';
  let kunciKoneksi = '';
  let kunciKepala = '';
  let logTerakhir = 0;
  let berhenti = false;
  let kodeTeks = '';
  let kodeMulai = 0;
  const semuaLog = []; // untuk tombol "Unduh"
  let tahanGulir = false;

  view.innerHTML = html`<div id="halamanServer">
    <a class="kembali-tautan" href="/dashboard">${ikon.kembali} Semua server</a>

    <header class="server-kepala">
      <div>
        <p class="kicker" id="sKicker"></p>
        <h1 class="server-nama" id="sNama"></h1>
        <p class="server-meta" id="sMeta"></p>
      </div>
      <div class="server-status">
        <span id="sLencana"></span>
        <div class="aksi">
          <button class="btn btn-sekunder btn-s" id="btnPerpanjang" type="button">${ikon.segar} Perpanjang</button>
          <button class="btn btn-sekunder btn-s" id="btnGantiNama" type="button">Ganti nama</button>
        </div>
      </div>
    </header>

    <div id="sPesan"></div>

    <div style="margin-top:24px">
      <article class="kartu" id="kartuKoneksi"></article>

      <article class="kartu">
        <header class="slug"><span class="slug-judul">Pengaturan bot</span><span class="slug-meta">Pengganti config.js</span></header>
        <div class="kartu-isi" id="isiPengaturan"></div>
      </article>

      <article class="kartu">
        <header class="slug"><span class="slug-judul">Cetakan langsung</span><span class="slug-live"><i></i>Langsung</span></header>
        <div class="cetak" id="cetak"><ol class="log" role="log" aria-live="off" id="log"></ol></div>
        <footer class="log-kaki">
          <span>400 baris terakhir · tersimpan sementara di server</span>
          <span class="aksi">
            <button class="btn btn-sekunder btn-s" id="btnTahan" type="button" aria-pressed="false">${ikon.jeda} Tahan gulir</button>
            <button class="btn btn-sekunder btn-s" id="btnUnduh" type="button">${ikon.unduh} Unduh</button>
          </span>
        </footer>
      </article>

      <article class="kartu">
        <header class="slug"><span class="slug-judul">Perintah bot</span><span class="slug-meta">lewat chat</span></header>
        <div class="kartu-isi">
          <p class="catatan-mini">Kirim dari chat WhatsApp nomor bot (misalnya chat ke diri sendiri) atau dari nomor owner tambahan. Awali dengan prefix, misalnya <span class="perintah">.menu</span>.</p>
          <ul class="cmd-ref" style="margin-top:14px">
            ${PERINTAH.map(([cmd, ket]) => html`<li><span class="perintah">${cmd}</span><span class="ket">${ket}</span></li>`)}
          </ul>
        </div>
      </article>

      <article class="kartu">
        <header class="slug"><span class="slug-judul">Hapus server</span><span class="slug-meta">zona bahaya</span></header>
        <div class="kartu-isi">
          <div class="catatan-bahaya" style="margin-bottom:16px">${ikon.peringatan}<span>Bot dimatikan, nomor dilepas, dan semua data server (whitelist, postingan Auto JPM) dihapus. Sisa masa aktif tidak dikembalikan.</span></div>
          <button class="btn btn-bahaya" id="btnHapus" type="button">Hapus server ini</button>
        </div>
      </article>
    </div>
  </div>`.s;

  const halaman = view.querySelector('#halamanServer');
  const $ = (sel) => halaman.querySelector(sel);
  const cetak = $('#cetak');
  const logEl = $('#log');

  // -------------------------------------------------------------------------
  // Kepala
  // -------------------------------------------------------------------------
  function gambarKepala() {
    const kunci = [server.name, server.status, server.phone, server.expiresAt, server.package?.name].join('|');
    if (kunci === kunciKepala) return;
    kunciKepala = kunci;

    const hariSisa = Math.floor((server.expiresAt - Date.now()) / 86400000);
    const segera = !server.expired && hariSisa <= 3;

    $('#sKicker').textContent = server.package ? `Paket ${server.package.name}` : 'Tanpa paket';
    $('#sNama').textContent = server.name;
    $('#sMeta').innerHTML = html`
      ${server.phone ? html`<span class="mono">${server.phone}</span>` : html`<span>Belum ada nomor</span>`}
      <span>${server.expired ? 'Masa aktif habis' : html`Aktif s/d ${tanggal(server.expiresAt)}`}</span>
      ${server.expired ? '' : html`<span class="sisa ${raw(segera ? 'segera' : '')}">${sisaWaktu(server.expiresAt)}</span>`}`.s;
    $('#sLencana').innerHTML = badgeStatus(server).s;
    app.setJudul(server.name);
  }

  function gambarPesan() {
    const tampil = server.message && server.status !== 'online';
    $('#sPesan').innerHTML = tampil
      ? html`<div class="catatan-peringatan" role="status">${ikon.info}<span>${server.message}</span></div>`.s
      : '';
  }

  // -------------------------------------------------------------------------
  // 5.7 — Panel pairing / kartu koneksi
  // -------------------------------------------------------------------------
  function gambarKoneksi(paksa = false) {
    const kunci = [server.phone, server.status, server.pairingCode, server.qrDataUrl, server.pendingPhone, server.expired, metode].join('|');
    if (!paksa && kunci === kunciKoneksi) return;
    kunciKoneksi = kunci;

    const kartu = $('#kartuKoneksi');

    // (1) Sudah tertaut ke nomor -> kartu koneksi
    if (server.phone) {
      const jalan = sedangJalan(server.status);
      kartu.innerHTML = html`
        <header class="slug"><span class="slug-judul">Nomor WhatsApp</span><span class="slug-meta">tertaut</span></header>
        <div class="kartu-isi">
          <div class="waktu-angka" style="font-size:34px;overflow-wrap:anywhere">${server.phone}</div>
          <p class="catatan-mini">${
            server.lastOnlineAt ? html`Terakhir online ${tanggal(server.lastOnlineAt, { jam: true })}.` : 'Belum pernah online.'
          }</p>
          ${server.expired ? html`<div class="catatan-bahaya" style="margin-top:14px">${ikon.peringatan}<span>Masa aktif habis. Perpanjang server untuk menyalakan bot lagi.</span></div>` : ''}
          <div class="aksi-jpm" style="margin-top:18px">
            ${jalan
              ? html`<button class="btn btn-sekunder" data-aksi="stop" type="button">${ikon.henti} Matikan</button>
                     <button class="btn btn-sekunder" data-aksi="restart" type="button">${ikon.segar} Nyalakan ulang</button>`
              : html`<button class="btn btn-utama" data-aksi="start" type="button" ${server.expired ? raw('disabled') : ''}>${ikon.putar} Nyalakan</button>`}
            <button class="btn btn-bahaya" data-aksi="logout" type="button" style="margin-left:auto">${ikon.kunci} Lepas nomor</button>
          </div>
          <p class="catatan-mini">Lepas nomor = logout bot dari WhatsApp. Setelah itu server bisa ditautkan ke nomor lain.</p>
        </div>`.s;
      return;
    }

    // (2) Masa aktif habis & belum ada nomor
    if (server.expired) {
      kartu.innerHTML = html`
        <header class="slug"><span class="slug-judul">Tautkan nomor</span><span class="slug-meta">kedaluwarsa</span></header>
        <div class="kartu-isi"><div class="catatan-bahaya">${ikon.peringatan}<span>Masa aktif server habis. Perpanjang dulu untuk menautkan nomor.</span></div></div>`.s;
      return;
    }

    // (3) Sedang proses login (punya kode / QR)
    const sedangLogin = ['starting', 'pairing', 'qr', 'connecting'].includes(server.status);
    if (sedangLogin && (server.pairingCode || server.qrDataUrl)) {
      kartu.innerHTML = html`
        <header class="slug"><span class="slug-judul">Tautkan nomor</span><span class="slug-meta">Langkah 2 dari 3</span></header>
        <div class="pairing">
          <div class="pairing-kode">
            <div class="pairing-atas">
              <p class="label" id="lblKode">${server.pairingCode ? 'Kode pairing kamu' : 'Scan QR dari HP lain'}</p>
              <div class="tab-ruas" role="tablist" aria-label="Cara menautkan">
                <button role="tab" type="button" data-metode="pairing" aria-selected="${raw(String(!!server.pairingCode))}">Kode</button>
                <button role="tab" type="button" data-metode="qr" aria-selected="${raw(String(!!server.qrDataUrl))}">Scan QR</button>
              </div>
            </div>
            ${server.pairingCode ? gambarTilKode(server.pairingCode) : gambarQr(server.qrDataUrl)}
            <p class="nomor-terkunci">${ikon.kunci}<span>Nomor <span class="mono">${server.pendingPhone ?? ''}</span> dikunci untuk server ini. 1 nomor = 1 server.</span><a href="#" data-aksi="cancel">Ganti nomor</a></p>
          </div>
          <div class="pairing-samping">
            <div class="waktu-kode">
              <span class="kicker">Berlaku</span>
              <b class="waktu-angka" data-countdown>01:00</b>
              <div class="bar bar-tipis"><i data-countdown-bar style="width:100%"></i></div>
            </div>
            ${server.pairingCode
              ? html`<button class="btn btn-utama" data-aksi="salin" type="button">${ikon.salin} Salin kode</button>`
              : ''}
            <button class="btn btn-sekunder" data-aksi="kode-baru" type="button">${ikon.segar} Kode baru</button>
          </div>
        </div>
        <ol class="langkah-baris">
          <li><span class="langkah-marker" aria-hidden="true"></span><span>Buka WhatsApp di HP, masuk ke <span class="jalur-menu">Perangkat tertaut</span>.</span></li>
          <li><span class="langkah-marker" aria-hidden="true"></span><span>Ketuk <b>Tautkan perangkat</b> ${server.pairingCode ? html`&rsaquo; <b>Tautkan dengan nomor telepon</b>` : '& arahkan kamera ke QR'}.</span></li>
          <li class="kini"><span class="langkah-marker" aria-hidden="true"></span><span>${server.pairingCode ? 'Ketik 8 karakter di atas. Kode baru dibuat otomatis kalau waktunya habis.' : 'QR berganti otomatis kalau kedaluwarsa.'}</span></li>
        </ol>`.s;

      // reset hitung mundur saat kode berganti
      const kodeSekarang = server.pairingCode || server.qrDataUrl || '';
      if (kodeSekarang !== kodeTeks) {
        kodeTeks = kodeSekarang;
        kodeMulai = Date.now();
      }
      return;
    }

    // (4) Menyiapkan
    if (sedangLogin) {
      kartu.innerHTML = html`
        <header class="slug"><span class="slug-judul">Tautkan nomor</span><span class="slug-meta">menyiapkan</span></header>
        <div class="kartu-isi"><div class="memuat">${server.method === 'qr' ? 'Menyiapkan QR' : 'Menyiapkan kode'}<span class="kursor"></span></div>
          <div class="aksi-jpm"><button class="btn btn-hantu btn-s" data-aksi="cancel" type="button">Batalkan</button></div>
        </div>`.s;
      return;
    }

    // (5) Belum ada nomor -> form sambung
    kodeTeks = '';
    kartu.innerHTML = html`
      <header class="slug"><span class="slug-judul">Tautkan nomor</span><span class="slug-meta">Langkah 1 dari 3</span></header>
      <div class="kartu-isi">
        <div class="pairing-atas">
          <p class="label" id="lblSambung">Cara menautkan</p>
          <div class="tab-ruas" role="tablist" aria-label="Cara menautkan">
            <button role="tab" type="button" data-metode="pairing" aria-selected="${raw(String(metode === 'pairing'))}">Kode</button>
            <button role="tab" type="button" data-metode="qr" aria-selected="${raw(String(metode === 'qr'))}">Scan QR</button>
          </div>
        </div>
        <p class="catatan-mini" style="margin-top:0;margin-bottom:16px">Tautkan nomor yang mau dijadikan bot. Sebaiknya pakai nomor cadangan khusus jualan.</p>
        <form id="formSambung" novalidate>
          ${metode === 'pairing'
            ? html`<div class="field" style="max-width:420px">
                <label class="label" for="telepon">Nomor WhatsApp</label>
                <div class="isian-gabung"><span class="akhiran akhiran-depan">+62</span><input class="isian mono" id="telepon" name="phone" inputmode="numeric" autocomplete="tel" placeholder="81234567890" required></div>
                <p class="bantu">Tulis tanpa 0 di depan. Contoh: 81234567890.</p>
              </div>`
            : html`<p class="catatan-mini" style="margin-top:0">QR muncul di sini setelah kamu menekan tombol. Siapkan HP yang nomornya mau dijadikan bot.</p>`}
          <div class="aksi-jpm">
            <button class="btn btn-utama" type="submit" id="btnSambung">${metode === 'pairing' ? 'Minta kode pairing' : 'Tampilkan QR'} ${ikon.panah}</button>
          </div>
        </form>
      </div>`.s;
  }

  function gambarTilKode(kode) {
    const bersih = String(kode).replace(/[^A-Za-z0-9]/g, '').toUpperCase();
    const karakter = bersih.split('');
    const til = [];
    karakter.forEach((c, i) => {
      if (i === 4) til.push(html`<i aria-hidden="true"></i>`);
      til.push(html`<span>${c}</span>`);
    });
    const label = karakter.join(' ');
    return html`<div class="kode" role="text" aria-label="Kode pairing ${label}">${til}</div>`;
  }

  function gambarQr(dataUrl) {
    return html`<div class="qr-kotak"><img src="${dataUrl}" alt="QR code login WhatsApp" width="264" height="264"></div>
      <p class="qr-ket">Scan dari HP lain: WhatsApp › Perangkat tertaut › Tautkan perangkat.</p>`;
  }

  // -------------------------------------------------------------------------
  // Pengaturan bot (field yang sudah ada)
  // -------------------------------------------------------------------------
  function gambarPengaturan() {
    const s = server.settings;
    $('#isiPengaturan').innerHTML = html`
      <p class="catatan-mini" style="margin-top:0">Kalau bot sedang jalan, bot dinyalakan ulang otomatis setelah disimpan.</p>
      <form id="formPengaturan" class="grid-isian" style="margin-top:16px" novalidate>
        <div class="field">
          <label class="label" for="namaBot">Nama bot</label>
          <input class="isian" id="namaBot" name="namaBot" maxlength="40" value="${s.namaBot}" required>
          <p class="bantu">Muncul di .menu & .ping.</p>
        </div>
        <div class="field">
          <label class="label" for="prefix">Prefix perintah</label>
          <input class="isian mono" id="prefix" name="prefix" maxlength="10" value="${s.prefix.join(' ')}" required>
          <p class="bantu">1–5 simbol, pisahkan dengan spasi. Contoh: <span class="perintah">.</span> <span class="perintah">#</span></p>
        </div>
        <div class="field">
          <label class="label" for="jedaKirim">Jeda antar grup <span class="opsi">min. 5 detik</span></label>
          <div class="isian-gabung"><input class="isian mono" id="jedaKirim" name="jedaKirim" type="number" min="5" max="600" value="${s.jedaKirim}" required><span class="akhiran">Detik</span></div>
          <p class="bantu">Jeda antar pengiriman ke tiap grup, dalam detik.</p>
        </div>
        <div class="field">
          <label class="label" for="jedaPutaran">Jeda putaran Auto JPM <span class="opsi">min. 10 menit</span></label>
          <div class="isian-gabung"><input class="isian mono" id="jedaPutaran" name="jedaPutaran" type="number" min="60" max="86400" value="${s.autojpm.jedaPutaran}" required><span class="akhiran">Detik</span></div>
          <p class="bantu" id="infoPutaran"></p>
        </div>
        <div class="field">
          <label class="label" for="mode">Mode</label>
          <select class="isian" id="mode" name="mode">
            <option value="production" ${s.mode === 'production' ? raw('selected') : ''}>Normal — pesan benar-benar dikirim</option>
            <option value="development" ${s.mode === 'development' ? raw('selected') : ''}>Uji coba — pesan massal tidak dikirim</option>
          </select>
          <p class="bantu">Mode uji coba hanya mencatat ke cetakan, cocok untuk coba alurnya.</p>
        </div>
        <div class="field">
          <label class="label" for="nomorOwner">Owner tambahan</label>
          <input class="isian mono" id="nomorOwner" name="nomorOwner" value="${s.nomorOwner.join(', ')}" placeholder="628111, 628222">
          <p class="bantu">Nomor lain yang boleh menyuruh bot. Pisahkan dengan koma. Nomor bot sendiri selalu boleh.</p>
        </div>
        <div class="field penuh">
          <label class="saklar"><input type="checkbox" name="tagSemua" ${s.autojpm.tagSemua ? raw('checked') : ''}><span>Auto JPM ikut tag semua anggota grup (hidetag)</span></label>
        </div>
        <div class="penuh"><button class="btn btn-utama" type="submit" id="btnPengaturan">Simpan pengaturan</button></div>
      </form>`.s;

    const info = () => {
      const detik = Number($('#jedaPutaran').value) || 0;
      $('#infoPutaran').textContent = `Sekitar ${Math.round(detik / 60)} menit. Waktu tunggu sebelum Auto JPM mengulang.`;
    };
    $('#jedaPutaran').addEventListener('input', info);
    info();
  }

  // -------------------------------------------------------------------------
  // 5.13 — Cetakan langsung (log)
  // -------------------------------------------------------------------------
  const TAG = {
    green: ['t-ok', 'OK'],
    yellow: ['t-sys', 'SYS'],
    blue: ['t-sys', 'SYS'],
    red: ['t-err', 'GAGAL'],
  };
  function barisLog(l) {
    let [cls, tag] = TAG[l.level] || ['t-sys', 'SYS'];
    const putus = l.level === 'red' && /terputus|putus|dikeluarkan|logout|401/i.test(l.text);
    if (putus) [cls, tag] = ['t-putus', 'PUTUS'];
    const err = cls === 't-err' || cls === 't-putus';
    const d = new Date(l.ts);
    const hh = String(d.getHours()).padStart(2, '0');
    const mm = String(d.getMinutes()).padStart(2, '0');
    const ss = String(d.getSeconds()).padStart(2, '0');
    return html`<li><time>${hh}.${mm}<span class="dt">.${ss}</span></time><b class="t ${raw(cls)}">${tag}</b><span class="pesan ${raw(err ? 'gagal' : '')}">${l.text}</span></li>`;
  }

  async function muatLog() {
    const { logs } = await api(`/servers/${id}/logs?after=${logTerakhir}`);
    if (!logs.length) return;
    const dekatBawah = cetak.scrollHeight - cetak.scrollTop - cetak.clientHeight < 60;
    logEl.insertAdjacentHTML('beforeend', logs.map(barisLog).map((r) => r.s).join(''));
    logs.forEach((l) => semuaLog.push(l));
    while (semuaLog.length > 1000) semuaLog.shift();
    while (logEl.childElementCount > 400) logEl.firstElementChild.remove();
    logTerakhir = logs[logs.length - 1].id;
    if (!tahanGulir && dekatBawah) cetak.scrollTop = cetak.scrollHeight;
  }

  // -------------------------------------------------------------------------
  // Gambar semua & pantau
  // -------------------------------------------------------------------------
  function gambarSemua(paksa = false) {
    gambarKepala();
    gambarPesan();
    gambarKoneksi(paksa);
  }

  gambarSemua(true);
  gambarPengaturan();
  await muatLog().catch(() => {});
  cetak.scrollTop = cetak.scrollHeight;

  const pantau = setInterval(async () => {
    if (document.hidden || berhenti || !masihAktif()) return;
    try {
      const tadinyaTanpaNomor = !server.phone;
      ({ server } = await api(`/servers/${id}`));
      if (berhenti || !masihAktif()) return;
      gambarSemua();
      if (tadinyaTanpaNomor && server.phone) toast(`Nomor ${server.phone} berhasil terhubung!`, 'ok', { kicker: 'Tertaut' });
      await muatLog();
    } catch (error) {
      if (error.status === 404) {
        berhenti = true;
        app.pergi('/dashboard');
      }
    }
  }, JEDA_PANTAU);

  const timerKode = setInterval(() => {
    if (!kodeMulai) return;
    const angka = halaman.querySelector('[data-countdown]');
    if (!angka) return;
    const sisa = Math.max(0, BERLAKU_KODE - Math.floor((Date.now() - kodeMulai) / 1000));
    angka.textContent = `${String(Math.floor(sisa / 60)).padStart(2, '0')}:${String(sisa % 60).padStart(2, '0')}`;
    const bar = halaman.querySelector('[data-countdown-bar]');
    if (bar) bar.style.width = `${(sisa / BERLAKU_KODE) * 100}%`;
  }, 1000);

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

  function mintaKode(m) {
    const telepon = server.pendingPhone;
    if (!telepon) return;
    jalankan(null, '/connect', { method: m, phone: telepon });
  }

  halaman.addEventListener('click', async (e) => {
    const metodeBtn = e.target.closest('[data-metode]');
    if (metodeBtn) {
      const m = metodeBtn.dataset.metode;
      // Saat sedang login: ganti metode = minta ulang dengan nomor yang sama.
      if (server.pendingPhone && ['starting', 'pairing', 'qr', 'connecting'].includes(server.status)) {
        if ((m === 'pairing') !== !!server.pairingCode) mintaKode(m);
      } else {
        metode = m;
        gambarKoneksi(true);
      }
      return;
    }

    const aksiEl = e.target.closest('[data-aksi]');
    if (!aksiEl) return;
    e.preventDefault();
    const aksi = aksiEl.dataset.aksi;

    if (aksi === 'salin') return salin(String(server.pairingCode).replace(/[^A-Za-z0-9]/g, ''));
    if (aksi === 'kode-baru') return mintaKode(server.pairingCode ? 'pairing' : 'qr');
    if (aksi === 'start') return void jalankan(aksiEl, '/start');
    if (aksi === 'restart') return void jalankan(aksiEl, '/restart');
    if (aksi === 'cancel') return void jalankan(aksiEl, '/cancel');
    if (aksi === 'stop') {
      if (await konfirmasi({ judul: 'Matikan bot?', slug: 'Matikan', pesan: 'Auto JPM dan autoreply yang sedang berjalan ikut berhenti.', ok: 'Matikan' }))
        await jalankan(aksiEl, '/stop');
      return;
    }
    if (aksi === 'logout') {
      const ok = await konfirmasi({
        judul: 'Lepas nomor dari server?',
        slug: 'Lepas nomor',
        pesan: `Bot logout dari WhatsApp nomor ${server.phone} dan sesinya dihapus. Kamu perlu pairing ulang untuk memakainya lagi. Kalau bot sedang mati, hapus juga perangkat tertaut di HP kamu secara manual.`,
        ok: 'Ya, lepas nomor',
        bahaya: true,
      });
      if (ok && (await jalankan(aksiEl, '/logout'))) toast('Nomor dilepas. Server siap ditautkan ke nomor lain.');
    }
  });

  halaman.addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = e.target;

    if (form.id === 'formSambung') {
      const body = { method: metode };
      if (metode === 'pairing') {
        body.phone = form.elements.phone.value.trim();
        if (!body.phone) return void toast('Isi nomor WhatsApp dulu.', 'error');
      }
      await jalankan(form.querySelector('#btnSambung'), '/connect', body);
      return;
    }

    if (form.id === 'formPengaturan') {
      const d = dataForm(form);
      try {
        const hasil = await sambilMemuat(form.querySelector('#btnPengaturan'), () =>
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
        toast(hasil.message || 'Pengaturan disimpan.');
      } catch (error) {
        toast(error.message, 'error');
      }
    }
  });

  // Tahan gulir & unduh
  $('#btnTahan').addEventListener('click', (e) => {
    tahanGulir = !tahanGulir;
    e.currentTarget.setAttribute('aria-pressed', String(tahanGulir));
    e.currentTarget.classList.toggle('tekan', tahanGulir);
    if (!tahanGulir) cetak.scrollTop = cetak.scrollHeight;
  });
  $('#btnUnduh').addEventListener('click', () => {
    const teks = semuaLog
      .map((l) => `${jam(l.ts)}  [${(l.level || 'sys').toUpperCase()}]  ${l.text}`)
      .join('\n');
    const blob = new Blob([teks || 'Belum ada log.'], { type: 'text/plain' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `log-server-${id}.txt`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  });

  // Perpanjang
  $('#btnPerpanjang').addEventListener('click', async () => {
    if (!packages.length) return void toast('Belum ada paket untuk perpanjang.', 'error');
    const qrisAktif = !!app.site?.qris?.enabled;
    const data = await formDialog({
      judul: 'Perpanjang server',
      slug: 'Perpanjang',
      pesan: qrisAktif
        ? `Saldo kamu ${rupiah(app.user.balance)}. Perpanjangan dipotong dari saldo; kalau kurang, bisa bayar lewat QRIS.`
        : `Saldo kamu ${rupiah(app.user.balance)}. Perpanjangan dipotong dari saldo.`,
      fields: [{ name: 'packageId', label: 'Paket', type: 'select', value: server.package?.id ?? packages[0].id, options: packages.map((p) => ({ value: p.id, label: `${p.name} — ${p.days} hari — ${rupiah(p.price)}` })) }],
      ok: 'Perpanjang',
    });
    if (!data) return;
    const paket = packages.find((p) => String(p.id) === String(data.packageId));
    if (!paket) return;

    // Saldo cukup -> potong saldo seperti biasa.
    if (app.user.balance >= paket.price) {
      const hasil = await jalankan(null, '/renew', { packageId: paket.id });
      if (hasil) {
        toast(hasil.message || 'Server diperpanjang.');
        app.muatUlangUser().catch(() => {});
      }
      return;
    }

    // Saldo kurang + QRIS aktif -> tawarkan bayar lewat QRIS.
    if (qrisAktif) {
      const ok = await konfirmasi({
        judul: 'Bayar lewat QRIS?',
        slug: 'Perpanjang',
        pesan: `Saldo kurang ${rupiah(paket.price - app.user.balance)}. Bayar kekurangannya lewat QRIS untuk memperpanjang ${paket.days} hari.`,
        ok: 'Buat QRIS',
      });
      if (!ok) return;
      try {
        const { invoice } = await kirimTagihan('/payment/renew', { body: { serverId: id, packageId: paket.id } });
        app.pergi(`/dashboard/invoice/${invoice.orderId}`);
      } catch (error) {
        if (error.code === 'SALDO_CUKUP') {
          const hasil = await jalankan(null, '/renew', { packageId: paket.id });
          if (hasil) {
            toast(hasil.message || 'Server diperpanjang.');
            app.muatUlangUser().catch(() => {});
          }
        } else if (error.code === 'PENDING_EXISTS' && error.orderId) {
          app.pergi(`/dashboard/invoice/${error.orderId}`);
        } else {
          toast(error.message, 'error');
        }
      }
      return;
    }

    // Saldo kurang, QRIS mati -> arahkan ke isi saldo.
    toast(`Saldo kurang ${rupiah(paket.price - app.user.balance)}. Isi saldo dulu.`, 'error');
    app.pergi('/dashboard/saldo');
  });

  // Ganti nama
  $('#btnGantiNama').addEventListener('click', async () => {
    const data = await formDialog({
      judul: 'Ganti nama server',
      slug: 'Ganti nama',
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

  // Hapus
  $('#btnHapus').addEventListener('click', async () => {
    const data = await formDialog({
      judul: 'Hapus server?',
      slug: 'Hapus server',
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
      app.pergi('/dashboard');
    } catch (error) {
      berhenti = false;
      toast(error.message, 'error');
    }
  });

  return () => {
    berhenti = true;
    clearInterval(pantau);
    clearInterval(timerKode);
  };
}

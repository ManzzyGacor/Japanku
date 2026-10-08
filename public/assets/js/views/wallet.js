import { api, html, raw, rupiah, tanggal, toast, sambilMemuat, dataForm } from '../lib.js';
import { ikon, konfirmasi } from '../ui.js';
import { kirimTagihan, capInvoice, jamWib } from './invoice.js';

const METODE = ['DANA', 'OVO', 'GoPay', 'ShopeePay', 'QRIS', 'Transfer bank'];
const NOMINAL_CEPAT = [10000, 25000, 50000, 100000];

const JENIS_TRANSAKSI = {
  topup: 'Top up',
  purchase: 'Beli server',
  renew: 'Perpanjang',
  adjust: 'Penyesuaian',
  refund: 'Pengembalian',
};

const grup = new Intl.NumberFormat('id-ID');
const angkaDari = (str) => Number(String(str).replace(/\D/g, '')) || 0;

/** Status top up manual sebagai cap-mini (§5.5). Diimpor juga oleh admin.js. */
export function badgeTopup(status) {
  if (status === 'approved') return html`<span class="cap-mini hijau">Berhasil</span>`;
  if (status === 'rejected') return html`<span class="cap-mini merah">Ditolak</span>`;
  if (status === 'cancelled') return html`<span class="cap-mini redup">Dibatalkan</span>`;
  return html`<span class="cap-mini kuning">Menunggu</span>`;
}

export async function halamanSaldo({ view, app, masihAktif }) {
  app.setJudul('Saldo');

  const gambar = async () => {
    const [wallet, { site }] = await Promise.all([api('/wallet'), api('/site'), app.muatUlangUser()]);
    if (!masihAktif()) return;
    app.site = site;

    const qris = site.qris || {};
    const adaQris = !!qris.enabled;
    const adaManual = !!site.manualTopup;
    const duaCara = adaQris && adaManual;
    const minManual = site.minTopup || 0;
    const minQ = Math.max(qris.minAmount || 1000, 1000);
    const pend = wallet.pendingInvoice;
    const invoices = wallet.invoices || [];

    const presetManual = NOMINAL_CEPAT.filter((n) => n >= minManual);
    const presetQris = NOMINAL_CEPAT.filter((n) => n >= minQ);

    // -- Pane QRIS otomatis ---------------------------------------------------
    const paneQris = () => html`
      <div class="pane" data-pane="qris">
        ${pend
          ? html`<div class="catatan-peringatan tagihan-aktif" role="status">
              ${ikon.peringatan}
              <div>
                <p>Kamu masih punya 1 tagihan aktif (<b class="mono">${pend.orderId}</b> &middot; ${rupiah(pend.amount)} &middot; hangus ${jamWib(pend.expiresAt)}).</p>
                <a class="btn btn-sekunder btn-s" href="/dashboard/invoice/${pend.orderId}">Lihat tagihan</a>
              </div>
            </div>`
          : ''}
        <form id="formQris" novalidate>
          <fieldset ${raw(pend ? 'disabled' : '')} style="border:0">
            <legend class="label">Nominal</legend>
            <div class="nominal">
              ${presetQris.map(
                (n, i) => html`<label><input type="radio" name="nomq" value="${n}" ${i === 0 ? raw('checked') : ''}><span>${grup.format(n / 1000)}rb</span></label>`,
              )}
              <label><input type="radio" name="nomq" value="lain"><span>Lain</span></label>
            </div>
            <div class="field" style="margin-top:18px;max-width:320px">
              <label class="label" for="jumlahQ">Jumlah <span class="opsi">min. ${rupiah(minQ)}</span></label>
              <div class="isian-gabung"><span class="akhiran akhiran-depan">Rp</span><input class="isian mono" id="jumlahQ" name="jumlahQ" inputmode="numeric" value="${raw(grup.format(presetQris[0] ?? minQ))}"></div>
            </div>
          </fieldset>
          <dl class="ringkasan" id="qRingkas"></dl>
          <button class="btn btn-utama btn-l btn-blok" type="submit" id="btnQris" ${raw(pend ? 'disabled' : '')} style="margin-top:18px">
            ${pend ? 'Tagihan aktif · selesaikan dulu' : html`Buat QRIS ${ikon.panah}`}
          </button>
          <p class="aturan">${ikon.info}<span>Satu akun hanya punya satu tagihan aktif. Tagihan hangus otomatis setelah ${qris.ttlMinutes || 5} menit, dan saldo masuk sendiri begitu pembayaran terkonfirmasi.</span></p>
        </form>
      </div>`;

    // -- Pane transfer manual -------------------------------------------------
    const paneManual = () => html`
      <div class="pane" data-pane="manual" ${raw(duaCara ? 'hidden' : '')}>
        <form id="formTopup" novalidate>
          <fieldset style="border:0">
            <legend class="label">Nominal</legend>
            <div class="nominal">
              ${presetManual.map(
                (n, i) => html`<label><input type="radio" name="nom" value="${n}" ${i === 0 ? raw('checked') : ''}><span>${grup.format(n / 1000)}rb</span></label>`,
              )}
              <label><input type="radio" name="nom" value="lain"><span>Lain</span></label>
            </div>
          </fieldset>
          <div class="field" style="margin-top:18px;max-width:320px">
            <label class="label" for="jumlah">Jumlah <span class="opsi">min. ${rupiah(minManual)}</span></label>
            <div class="isian-gabung"><span class="akhiran akhiran-depan">Rp</span><input class="isian mono" id="jumlah" name="jumlah" inputmode="numeric" value="${raw(grup.format(presetManual[0] ?? minManual))}" required></div>
          </div>
          <div class="field">
            <label class="label" for="metode">Dibayar lewat</label>
            <select class="isian" id="metode" name="method">${METODE.map((m) => html`<option>${m}</option>`)}</select>
          </div>
          <div class="field">
            <label class="label" for="note">Catatan untuk admin <span class="opsi">opsional</span></label>
            <input class="isian" id="note" name="note" maxlength="300" placeholder="mis. nama pengirim / 4 digit akhir rekening">
          </div>
          <div class="catatan" style="margin-top:4px">${site.paymentInstructions || 'Admin belum mengisi instruksi pembayaran.'}</div>
          ${site.paymentQrisUrl
            ? html`<div class="qr-kotak" style="margin-top:14px"><img src="${site.paymentQrisUrl}" alt="QRIS pembayaran" loading="lazy"></div>`
            : ''}
          <button class="btn btn-utama btn-l btn-blok" type="submit" id="btnTopup" style="margin-top:18px">Kirim permintaan top up</button>
          <p class="aturan">${ikon.info}<span>Bayar dulu sesuai nominal, lalu kirim permintaan ini. Saldo masuk setelah dicek admin.</span></p>
        </form>
      </div>`;

    const metaKartu = duaCara ? 'QRIS & manual' : adaQris ? 'QRIS otomatis' : 'transfer manual';

    view.innerHTML = html`<div id="halamanSaldo">
      <div class="kepala-halaman">
        <div>
          <p class="kicker">Dompet</p>
          <h1>Saldo</h1>
          <p class="sub">Saldo dipakai untuk membeli dan memperpanjang server.</p>
        </div>
      </div>

      <div class="topup-grid">
        <section class="kartu">
          <header class="slug"><span class="slug-judul">Isi saldo</span><span class="slug-meta">${metaKartu}</span></header>
          <div class="kartu-isi">
            ${duaCara
              ? html`<div class="tab-ruas isi-tab" role="tablist" aria-label="Cara isi saldo" style="margin-bottom:18px">
                  <button role="tab" type="button" data-tab="qris" aria-selected="true">QRIS otomatis</button>
                  <button role="tab" type="button" data-tab="manual" aria-selected="false">Transfer manual</button>
                </div>`
              : ''}
            ${adaQris ? paneQris() : ''}
            ${adaManual ? paneManual() : ''}
          </div>
        </section>

        <section class="kartu" style="margin-top:0">
          <header class="slug"><span class="slug-judul">Saldo kamu</span><span class="slug-meta">dompet</span></header>
          <div class="kartu-isi">
            <b class="waktu-angka mono" style="font-size:46px;color:var(--hijau)">${rupiah(wallet.balance)}</b>
            <p class="catatan-mini">Butuh bantuan? ${site.contactWhatsapp
              ? html`Chat admin di <a href="https://wa.me/${site.contactWhatsapp}" target="_blank" rel="noopener" data-luar style="text-decoration:underline;text-underline-offset:3px">WhatsApp</a>.`
              : 'Hubungi admin.'}</p>
          </div>
        </section>
      </div>

      ${adaQris || invoices.length
        ? html`<section class="kartu" style="margin-top:24px">
            <header class="slug"><span class="slug-judul">Tagihan QRIS</span><span class="slug-meta">${invoices.length} entri</span></header>
            <div class="kartu-isi" style="padding:0">
              ${invoices.length
                ? html`<div class="tabel-gulir"><table class="tabel">
                    <thead><tr><th>Waktu</th><th>No.</th><th>Keterangan</th><th style="text-align:right">Jumlah</th><th>Status</th></tr></thead>
                    <tbody>${invoices.map(
                      (inv) => html`<tr>
                        <td class="waktu">${tanggal(inv.createdAt, { jam: true })}</td>
                        <td class="no"><a href="/dashboard/invoice/${inv.orderId}">${inv.orderId}</a></td>
                        <td class="ket">${inv.label}${inv.result === 'saldo_only' && inv.resultNote ? html`<small>${inv.resultNote}</small>` : ''}</td>
                        <td class="angka ${raw(inv.status === 'completed' ? 'plus' : 'lemah')}">${inv.status === 'completed' ? `+${rupiah(inv.subtotal)}` : rupiah(inv.amount)}</td>
                        <td class="status">${capInvoice(inv.status)}</td>
                      </tr>`,
                    )}</tbody></table></div>`
                : html`<div style="padding:16px"><p class="catatan-mini" style="margin:0">Belum ada tagihan QRIS.</p></div>`}
            </div>
          </section>`
        : ''}

      ${adaManual || wallet.topups.length
        ? html`<section class="kartu" style="margin-top:24px">
            <header class="slug"><span class="slug-judul">Riwayat top up</span><span class="slug-meta">${wallet.topups.length} entri</span></header>
            <div class="kartu-isi" style="padding:0">
              ${wallet.topups.length
                ? html`<div class="tabel-gulir"><table class="tabel">
                    <thead><tr><th>Waktu</th><th>No.</th><th>Keterangan</th><th style="text-align:right">Nominal</th><th>Status</th><th></th></tr></thead>
                    <tbody>${wallet.topups.map(
                      (t) => html`<tr>
                        <td class="waktu">${tanggal(t.created_at, { jam: true })}</td>
                        <td class="no">#${t.id}</td>
                        <td class="ket">${t.method}${t.note || t.admin_note ? html`<small>${t.note || t.admin_note}</small>` : ''}</td>
                        <td class="angka plus">+${rupiah(t.amount)}</td>
                        <td class="status">${badgeTopup(t.status)}</td>
                        <td>${t.status === 'pending' ? html`<button class="btn btn-hantu btn-s" data-batal="${t.id}" type="button">Batalkan</button>` : ''}</td>
                      </tr>`,
                    )}</tbody></table></div>`
                : html`<div style="padding:16px"><p class="catatan-mini" style="margin:0">Belum ada top up.</p></div>`}
            </div>
          </section>`
        : ''}

      <section class="kartu" style="margin-top:24px">
        <header class="slug"><span class="slug-judul">Mutasi saldo</span><span class="slug-meta">${wallet.transactions.length} entri</span></header>
        <div class="kartu-isi" style="padding:0">
          ${wallet.transactions.length
            ? html`<div class="tabel-gulir"><table class="tabel">
                <thead><tr><th>Waktu</th><th>Jenis</th><th>Keterangan</th><th style="text-align:right">Jumlah</th><th style="text-align:right">Saldo</th></tr></thead>
                <tbody>${wallet.transactions.map(
                  (t) => html`<tr>
                    <td class="waktu">${tanggal(t.created_at, { jam: true })}</td>
                    <td class="status">${JENIS_TRANSAKSI[t.type] ?? t.type}</td>
                    <td class="ket">${t.description}</td>
                    <td class="angka ${raw(t.amount >= 0 ? 'plus' : '')}">${t.amount >= 0 ? '+' : '−'}${rupiah(Math.abs(t.amount))}</td>
                    <td class="no">${rupiah(t.balance_after)}</td>
                  </tr>`,
                )}</tbody></table></div>`
            : html`<div style="padding:16px"><p class="catatan-mini" style="margin:0">Belum ada mutasi.</p></div>`}
        </div>
      </section>
    </div>`.s;

    const halaman = view.querySelector('#halamanSaldo');

    // -- Tab QRIS / manual ----------------------------------------------------
    if (duaCara) {
      const tombolTab = halaman.querySelectorAll('.isi-tab [data-tab]');
      const panes = halaman.querySelectorAll('.pane');
      tombolTab.forEach((btn) => {
        btn.addEventListener('click', () => {
          tombolTab.forEach((b) => b.setAttribute('aria-selected', String(b === btn)));
          panes.forEach((p) => (p.hidden = p.dataset.pane !== btn.dataset.tab));
        });
      });
    }

    // -- Hubungkan ubin nominal <-> kolom jumlah ------------------------------
    const sambungNominal = (form, radioName, inputEl) => {
      if (!form || !inputEl) return;
      form.addEventListener('change', (e) => {
        if (e.target.name !== radioName) return;
        if (e.target.value === 'lain') {
          inputEl.focus();
          inputEl.select();
        } else {
          inputEl.value = grup.format(Number(e.target.value));
        }
      });
      inputEl.addEventListener('input', () => {
        const n = angkaDari(inputEl.value);
        const cocok = form.querySelector(`input[name="${radioName}"][value="${n}"]`);
        (cocok || form.querySelector(`input[name="${radioName}"][value="lain"]`)).checked = true;
      });
      inputEl.addEventListener('blur', () => {
        const n = angkaDari(inputEl.value);
        if (n) inputEl.value = grup.format(n);
      });
    };

    // -- QRIS otomatis --------------------------------------------------------
    const formQris = halaman.querySelector('#formQris');
    if (formQris && !pend) {
      const jumlahQ = formQris.elements.jumlahQ;
      const ringkasQ = () => {
        const amount = angkaDari(jumlahQ.value);
        const fee = qris.fee || 0;
        formQris.querySelector('#qRingkas').innerHTML = html`
          <div><dt>Isi saldo</dt><dd>${rupiah(amount)}</dd></div>
          <div><dt>Biaya admin</dt><dd>${rupiah(fee)}</dd></div>
          <div class="total"><dt>Total dibayar</dt><dd>${rupiah(amount + fee)}</dd></div>`.s;
      };
      sambungNominal(formQris, 'nomq', jumlahQ);
      jumlahQ.addEventListener('input', ringkasQ);
      formQris.addEventListener('change', (e) => { if (e.target.name === 'nomq') ringkasQ(); });
      ringkasQ();

      formQris.addEventListener('submit', async (e) => {
        e.preventDefault();
        const amount = angkaDari(jumlahQ.value);
        if (!amount || amount < minQ) return void toast(`Nominal minimal ${rupiah(minQ)}.`, 'error');
        try {
          const { invoice } = await sambilMemuat(formQris.querySelector('#btnQris'), () =>
            kirimTagihan('/payment/topup', { body: { amount } }),
          );
          app.pergi(`/dashboard/invoice/${invoice.orderId}`);
        } catch (error) {
          if (error.code === 'PENDING_EXISTS' && error.orderId) return void app.pergi(`/dashboard/invoice/${error.orderId}`);
          if (error.status === 409) {
            // Balapan: tagihan aktif muncul di sisi lain. Ambil ulang & arahkan.
            try {
              const w = await api('/wallet');
              if (w.pendingInvoice) return void app.pergi(`/dashboard/invoice/${w.pendingInvoice.orderId}`);
            } catch {
              /* abaikan */
            }
          }
          toast(error.message, 'error');
        }
      });
    }

    // -- Transfer manual ------------------------------------------------------
    const formTopup = halaman.querySelector('#formTopup');
    if (formTopup) {
      const jumlah = formTopup.elements.jumlah;
      sambungNominal(formTopup, 'nom', jumlah);
      formTopup.addEventListener('submit', async (e) => {
        e.preventDefault();
        const d = dataForm(formTopup);
        const amount = angkaDari(d.jumlah);
        if (!amount || amount < minManual) return void toast(`Nominal minimal ${rupiah(minManual)}.`, 'error');
        try {
          const hasil = await sambilMemuat(formTopup.querySelector('#btnTopup'), () =>
            api('/topups', { method: 'POST', body: { amount, method: d.method, note: d.note } }),
          );
          toast(hasil.message || 'Permintaan top up terkirim.', 'ok', { kicker: 'Top up' });
          await gambar();
        } catch (error) {
          toast(error.message, 'error');
        }
      });
    }

    // -- Batalkan top up manual ----------------------------------------------
    halaman.addEventListener('click', async (e) => {
      const batal = e.target.closest('[data-batal]');
      if (!batal) return;
      if (!(await konfirmasi({ judul: 'Batalkan top up ini?', slug: 'Batalkan', ok: 'Batalkan top up', bahaya: true }))) return;
      try {
        await sambilMemuat(batal, () => api(`/topups/${batal.dataset.batal}/cancel`, { method: 'POST' }));
        toast('Top up dibatalkan.');
        await gambar();
      } catch (error) {
        toast(error.message, 'error');
      }
    });
  };

  await gambar();
  return undefined;
}

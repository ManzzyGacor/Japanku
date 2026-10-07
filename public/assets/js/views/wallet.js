import { api, html, raw, rupiah, tanggal, toast, sambilMemuat, dataForm } from '../lib.js';
import { ikon, konfirmasi } from '../ui.js';

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

/** Status top up sebagai cap-mini (§5.5). Diimpor juga oleh admin.js. */
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

    const presets = NOMINAL_CEPAT.filter((n) => n >= site.minTopup);

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
          <header class="slug"><span class="slug-judul">Isi saldo</span><span class="slug-meta">manual</span></header>
          <div class="kartu-isi">
            <form id="formTopup" novalidate>
              <fieldset style="border:0">
                <legend class="label">Nominal</legend>
                <div class="nominal">
                  ${presets.map(
                    (n, i) => html`<label><input type="radio" name="nom" value="${n}" ${i === 0 ? raw('checked') : ''}><span>${grup.format(n / 1000)}rb</span></label>`,
                  )}
                  <label><input type="radio" name="nom" value="lain"><span>Lain</span></label>
                </div>
              </fieldset>

              <div class="field" style="margin-top:18px;max-width:320px">
                <label class="label" for="jumlah">Jumlah <span class="opsi">min. ${rupiah(site.minTopup)}</span></label>
                <div class="isian-gabung"><span class="akhiran akhiran-depan">Rp</span><input class="isian mono" id="jumlah" name="jumlah" inputmode="numeric" value="${raw(grup.format(presets[0] ?? site.minTopup))}" required></div>
              </div>

              <div class="field">
                <label class="label" for="metode">Dibayar lewat</label>
                <select class="isian" id="metode" name="method">${METODE.map((m) => html`<option>${m}</option>`)}</select>
              </div>

              <div class="field">
                <label class="label" for="note">Catatan untuk admin <span class="opsi">opsional</span></label>
                <input class="isian" id="note" name="note" maxlength="300" placeholder="mis. nama pengirim / 4 digit akhir rekening">
              </div>

              <div class="catatan" style="margin-top:4px">
                ${site.paymentInstructions || 'Admin belum mengisi instruksi pembayaran.'}
              </div>
              ${site.paymentQrisUrl
                ? html`<div class="qr-kotak" style="margin-top:14px"><img src="${site.paymentQrisUrl}" alt="QRIS pembayaran" loading="lazy"></div>`
                : ''}

              <button class="btn btn-utama btn-l btn-blok" type="submit" id="btnTopup" style="margin-top:18px">Kirim permintaan top up</button>
              <p class="aturan">${ikon.info}<span>Bayar dulu sesuai nominal, lalu kirim permintaan ini. Saldo masuk setelah dicek admin.</span></p>
            </form>
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

      <section class="kartu" style="margin-top:24px">
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
      </section>

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
    const form = halaman.querySelector('#formTopup');
    const jumlah = form.elements.jumlah;

    // Ubin nominal <-> kolom jumlah
    form.addEventListener('change', (e) => {
      if (e.target.name !== 'nom') return;
      if (e.target.value === 'lain') {
        jumlah.focus();
        jumlah.select();
      } else {
        jumlah.value = grup.format(Number(e.target.value));
      }
    });
    jumlah.addEventListener('input', () => {
      const n = angkaDari(jumlah.value);
      const cocok = form.querySelector(`input[name="nom"][value="${n}"]`);
      (cocok || form.querySelector('input[name="nom"][value="lain"]')).checked = true;
    });
    jumlah.addEventListener('blur', () => {
      const n = angkaDari(jumlah.value);
      if (n) jumlah.value = grup.format(n);
    });

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

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const d = dataForm(form);
      const amount = angkaDari(d.jumlah);
      if (!amount || amount < site.minTopup) return void toast(`Nominal minimal ${rupiah(site.minTopup)}.`, 'error');
      try {
        const hasil = await sambilMemuat(form.querySelector('#btnTopup'), () =>
          api('/topups', { method: 'POST', body: { amount, method: d.method, note: d.note } }),
        );
        toast(hasil.message || 'Permintaan top up terkirim.', 'ok', { kicker: 'Top up' });
        await gambar();
      } catch (error) {
        toast(error.message, 'error');
      }
    });
  };

  await gambar();
  return undefined;
}

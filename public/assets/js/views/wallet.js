import { api, html, rupiah, tanggal, toast, sambilMemuat, dataForm } from '../lib.js';
import { konfirmasi } from '../ui.js';

const METODE = ['DANA', 'OVO', 'GoPay', 'ShopeePay', 'QRIS', 'Transfer bank'];
const NOMINAL_CEPAT = [10000, 25000, 50000, 100000];

const JENIS_TRANSAKSI = {
  topup: 'Top up',
  purchase: 'Beli server',
  renew: 'Perpanjang',
  adjust: 'Penyesuaian',
  refund: 'Pengembalian',
};

export function badgeTopup(status) {
  if (status === 'approved') return html`<span class="badge badge-online">Berhasil</span>`;
  if (status === 'rejected') return html`<span class="badge badge-bad">Ditolak</span>`;
  if (status === 'cancelled') return html`<span class="badge badge-off">Dibatalkan</span>`;
  return html`<span class="badge badge-wait">Menunggu</span>`;
}

export async function halamanSaldo({ view, app }) {
  app.setJudul('Saldo & top up');

  const gambar = async () => {
    const [wallet, { site }] = await Promise.all([api('/wallet'), api('/site'), app.muatUlangUser()]);
    app.site = site;

    view.innerHTML = html`<div id="walletPage">
      <div class="page-head">
        <div>
          <h2>Saldo & top up</h2>
          <p>Saldo dipakai untuk membeli dan memperpanjang server.</p>
        </div>
      </div>

      <div class="grid-2">
        <section class="card">
          <div class="card-title"><h3>Saldo kamu</h3></div>
          <div class="balance-big">${rupiah(wallet.balance)}</div>
          <p class="muted small" style="margin-top:6px">Butuh bantuan? ${site.contactWhatsapp
            ? html`Chat admin di <a href="https://wa.me/${site.contactWhatsapp}" target="_blank" rel="noopener">WhatsApp</a>.`
            : 'Hubungi admin.'}</p>
        </section>

        <section class="card">
          <div class="card-title"><h3>Isi saldo</h3></div>
          <div class="pay-info">${site.paymentInstructions || 'Admin belum mengisi instruksi pembayaran.'}</div>
          ${site.paymentQrisUrl ? html`<div class="pay-qris"><img src="${site.paymentQrisUrl}" alt="QRIS pembayaran"></div>` : ''}
          <form id="topupForm" novalidate>
            <div class="field">
              <label for="amount">Nominal (Rp)</label>
              <input class="input" id="amount" name="amount" type="number" min="${site.minTopup}" step="1000" placeholder="Minimal ${rupiah(site.minTopup)}" required>
            </div>
            <div class="quick-amounts">
              ${NOMINAL_CEPAT.filter((n) => n >= site.minTopup).map(
                (n) => html`<button type="button" class="btn btn-soft btn-sm" data-nominal="${n}">${rupiah(n)}</button>`,
              )}
            </div>
            <div class="field">
              <label for="method">Dibayar lewat</label>
              <select class="select" id="method" name="method">${METODE.map((m) => html`<option>${m}</option>`)}</select>
            </div>
            <div class="field">
              <label for="note">Catatan untuk admin</label>
              <input class="input" id="note" name="note" maxlength="300" placeholder="Misalnya: nama pengirim / 4 digit akhir rekening">
              <span class="hint">Bayar dulu sesuai nominal, lalu kirim permintaan ini. Saldo masuk setelah dicek admin.</span>
            </div>
            <button class="btn btn-primary btn-block" type="submit" id="topupBtn">Kirim permintaan top up</button>
          </form>
        </section>
      </div>

      <section class="card" style="margin-top:18px">
        <div class="card-title"><h3>Riwayat top up</h3></div>
        ${wallet.topups.length
          ? html`<div class="table-wrap"><table class="table">
              <thead><tr><th>Tanggal</th><th>Nominal</th><th>Metode</th><th>Status</th><th></th></tr></thead>
              <tbody>${wallet.topups.map(
                (t) => html`<tr>
                  <td class="nowrap">${tanggal(t.created_at, { jam: true })}<small>#${t.id}</small></td>
                  <td class="nowrap"><b>${rupiah(t.amount)}</b></td>
                  <td>${t.method}${t.note ? html`<small>${t.note}</small>` : ''}</td>
                  <td>${badgeTopup(t.status)}${t.admin_note ? html`<small>${t.admin_note}</small>` : ''}</td>
                  <td class="text-right">${t.status === 'pending' ? html`<button class="btn btn-ghost btn-sm" data-batal-topup="${t.id}">Batalkan</button>` : ''}</td>
                </tr>`,
              )}</tbody></table></div>`
          : html`<p class="muted">Belum ada top up.</p>`}
      </section>

      <section class="card" style="margin-top:18px">
        <div class="card-title"><h3>Mutasi saldo</h3></div>
        ${wallet.transactions.length
          ? html`<div class="table-wrap"><table class="table">
              <thead><tr><th>Tanggal</th><th>Jenis</th><th>Keterangan</th><th class="text-right">Jumlah</th><th class="text-right">Saldo</th></tr></thead>
              <tbody>${wallet.transactions.map(
                (t) => html`<tr>
                  <td class="nowrap">${tanggal(t.created_at, { jam: true })}</td>
                  <td class="nowrap">${JENIS_TRANSAKSI[t.type] ?? t.type}</td>
                  <td>${t.description}</td>
                  <td class="text-right ${t.amount >= 0 ? 'amount-plus' : 'amount-minus'}">${t.amount >= 0 ? '+' : '−'}${rupiah(Math.abs(t.amount))}</td>
                  <td class="text-right nowrap">${rupiah(t.balance_after)}</td>
                </tr>`,
              )}</tbody></table></div>`
          : html`<p class="muted">Belum ada mutasi.</p>`}
      </section>
    </div>`.s;

    const halaman = view.querySelector('#walletPage');
    const form = halaman.querySelector('#topupForm');

    halaman.addEventListener('click', async (e) => {
      const cepat = e.target.closest('[data-nominal]');
      if (cepat) form.elements.amount.value = cepat.dataset.nominal;

      const batal = e.target.closest('[data-batal-topup]');
      if (batal) {
        const ok = await konfirmasi({ judul: 'Batalkan top up ini?', ok: 'Batalkan top up', bahaya: true });
        if (!ok) return;
        try {
          await sambilMemuat(batal, () => api(`/topups/${batal.dataset.batalTopup}/cancel`, { method: 'POST' }));
          toast('Top up dibatalkan.');
          await gambar();
        } catch (error) {
          toast(error.message, 'error');
        }
      }
    });

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const d = dataForm(form);
      const amount = Number(d.amount);
      if (!amount || amount < site.minTopup) return toast(`Nominal minimal ${rupiah(site.minTopup)}.`, 'error');

      try {
        const hasil = await sambilMemuat(form.querySelector('#topupBtn'), () =>
          api('/topups', { method: 'POST', body: { amount, method: d.method, note: d.note } }),
        );
        toast(hasil.message);
        await gambar();
      } catch (error) {
        toast(error.message, 'error');
      }
    });
  };

  await gambar();
  return undefined;
}

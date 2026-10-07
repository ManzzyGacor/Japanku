import { api, html, tanggal, toast, sambilMemuat, dataForm } from '../lib.js';

export async function halamanAkun({ view, app }) {
  app.setJudul('Akun');
  const u = await app.muatUlangUser();

  const sandi = (id, label, autocomplete) => html`
    <div class="field">
      <label class="label" for="${id}">${label}</label>
      <div class="isian-gabung">
        <input class="isian" id="${id}" name="${id}" type="password" autocomplete="${autocomplete}" minlength="8" required>
        <button class="akhiran akhiran-tautan" type="button" data-lihat="${id}" aria-label="Tampilkan kata sandi">Lihat</button>
      </div>
    </div>`;

  view.innerHTML = html`<div id="halamanAkun">
    <div class="kepala-halaman">
      <div>
        <p class="kicker">Akun</p>
        <h1>Akun</h1>
        <p class="sub">Terdaftar sejak ${tanggal(u.createdAt)}.</p>
      </div>
    </div>

    <section class="kartu">
      <header class="slug"><span class="slug-judul">Profil</span><span class="slug-meta">meja siaran</span></header>
      <div class="kartu-isi">
        <form id="formProfil" class="grid-isian" novalidate>
          <div class="field">
            <label class="label" for="nama">Nama</label>
            <input class="isian" id="nama" name="name" maxlength="60" value="${u.name}" required>
          </div>
          <div class="field">
            <label class="label" for="email">Email</label>
            <input class="isian" id="email" value="${u.email}" readonly>
            <p class="bantu">Email tidak bisa diganti.</p>
          </div>
          <div class="penuh"><button class="btn btn-utama" type="submit" id="btnProfil">Simpan</button></div>
        </form>
      </div>
    </section>

    <section class="kartu">
      <header class="slug"><span class="slug-judul">${u.hasPassword ? 'Kata sandi' : 'Buat kata sandi'}</span><span class="slug-meta">keamanan</span></header>
      <div class="kartu-isi">
        ${u.hasPassword ? '' : html`<p class="catatan-mini" style="margin-top:0">Akun ini dibuat lewat Google. Buat kata sandi supaya bisa masuk dengan email juga.</p>`}
        <form id="formSandi" novalidate>
          <div class="grid-isian">
            ${u.hasPassword
              ? html`<div class="field penuh">
                  <label class="label" for="currentPassword">Kata sandi lama</label>
                  <div class="isian-gabung">
                    <input class="isian" id="currentPassword" name="currentPassword" type="password" autocomplete="current-password" required>
                    <button class="akhiran akhiran-tautan" type="button" data-lihat="currentPassword" aria-label="Tampilkan kata sandi">Lihat</button>
                  </div>
                </div>`
              : ''}
            ${sandi('newPassword', 'Kata sandi baru', 'new-password')}
            ${sandi('newPassword2', 'Ulangi kata sandi baru', 'new-password')}
          </div>
          <button class="btn btn-utama" type="submit" id="btnSandi" style="margin-top:18px">Simpan kata sandi</button>
          <p class="bantu">Setelah diganti, perangkat lain yang sedang masuk akan dikeluarkan.</p>
        </form>
      </div>
    </section>
  </div>`.s;

  const halaman = view.querySelector('#halamanAkun');

  halaman.addEventListener('click', (e) => {
    const lihat = e.target.closest('[data-lihat]');
    if (!lihat) return;
    const inp = halaman.querySelector(`#${lihat.dataset.lihat}`);
    const tampil = inp.type === 'password';
    inp.type = tampil ? 'text' : 'password';
    lihat.textContent = tampil ? 'Tutup' : 'Lihat';
  });

  halaman.querySelector('#formProfil').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      await sambilMemuat(halaman.querySelector('#btnProfil'), () =>
        api('/account', { method: 'PUT', body: { name: dataForm(e.target).name } }),
      );
      await app.muatUlangUser();
      toast('Profil disimpan.');
    } catch (error) {
      toast(error.message, 'error');
    }
  });

  halaman.querySelector('#formSandi').addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = e.target;
    const d = dataForm(form);
    if ((d.newPassword ?? '').length < 8) return void toast('Kata sandi baru minimal 8 karakter.', 'error');
    if (d.newPassword !== d.newPassword2) return void toast('Ulangi kata sandi baru belum sama.', 'error');
    try {
      const hasil = await sambilMemuat(halaman.querySelector('#btnSandi'), () =>
        api('/account/password', { method: 'PUT', body: { currentPassword: d.currentPassword, newPassword: d.newPassword } }),
      );
      form.reset();
      toast(hasil.message || 'Kata sandi disimpan.');
      if (!u.hasPassword) halamanAkun({ view, app });
    } catch (error) {
      toast(error.message, 'error');
    }
  });

  return undefined;
}

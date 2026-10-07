import { api, html, tanggal, toast, sambilMemuat, dataForm } from '../lib.js';

export async function halamanAkun({ view, app }) {
  app.setJudul('Akun');
  const u = await app.muatUlangUser();

  view.innerHTML = html`<div id="accountPage">
    <div class="page-head">
      <div>
        <h2>Akun</h2>
        <p>Terdaftar sejak ${tanggal(u.createdAt)}.</p>
      </div>
    </div>

    <div class="grid-2">
      <section class="card">
        <div class="card-title"><h3>Profil</h3></div>
        <form id="profileForm" novalidate>
          <div class="field">
            <label for="name">Nama</label>
            <input class="input" id="name" name="name" maxlength="60" value="${u.name}" required>
          </div>
          <div class="field">
            <label for="email">Email</label>
            <input class="input" id="email" value="${u.email}" disabled>
            <span class="hint">Email tidak bisa diganti.</span>
          </div>
          <button class="btn btn-primary" type="submit" id="profileBtn">Simpan</button>
        </form>
      </section>

      <section class="card">
        <div class="card-title"><h3>${u.hasPassword ? 'Ganti kata sandi' : 'Buat kata sandi'}</h3></div>
        ${u.hasPassword ? '' : html`<p class="card-sub">Akun ini dibuat lewat Google. Buat kata sandi supaya bisa masuk dengan email juga.</p>`}
        <form id="passwordForm" novalidate>
          ${u.hasPassword
            ? html`<div class="field">
                <label for="currentPassword">Kata sandi lama</label>
                <input class="input" id="currentPassword" name="currentPassword" type="password" autocomplete="current-password" required>
              </div>`
            : ''}
          <div class="field">
            <label for="newPassword">Kata sandi baru</label>
            <input class="input" id="newPassword" name="newPassword" type="password" autocomplete="new-password" minlength="8" required>
          </div>
          <div class="field">
            <label for="newPassword2">Ulangi kata sandi baru</label>
            <input class="input" id="newPassword2" name="newPassword2" type="password" autocomplete="new-password" minlength="8" required>
          </div>
          <button class="btn btn-primary" type="submit" id="passwordBtn">Simpan kata sandi</button>
          <p class="hint" style="margin-top:12px">Setelah diganti, perangkat lain yang sedang masuk akan dikeluarkan.</p>
        </form>
      </section>
    </div>
  </div>`.s;

  const halaman = view.querySelector('#accountPage');

  halaman.querySelector('#profileForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      await sambilMemuat(halaman.querySelector('#profileBtn'), () =>
        api('/account', { method: 'PUT', body: { name: dataForm(e.target).name } }),
      );
      await app.muatUlangUser();
      toast('Profil disimpan.');
    } catch (error) {
      toast(error.message, 'error');
    }
  });

  halaman.querySelector('#passwordForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = e.target;
    const d = dataForm(form);
    if ((d.newPassword ?? '').length < 8) return toast('Kata sandi baru minimal 8 karakter.', 'error');
    if (d.newPassword !== d.newPassword2) return toast('Ulangi kata sandi baru belum sama.', 'error');

    try {
      const hasil = await sambilMemuat(halaman.querySelector('#passwordBtn'), () =>
        api('/account/password', { method: 'PUT', body: { currentPassword: d.currentPassword, newPassword: d.newPassword } }),
      );
      form.reset();
      toast(hasil.message);
      if (!u.hasPassword) halamanAkun({ view, app });
    } catch (error) {
      toast(error.message, 'error');
    }
  });

  return undefined;
}

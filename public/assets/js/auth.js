import { api, dataForm, sambilMemuat } from './lib.js';

const form = document.getElementById('authForm');
const mode = form.dataset.mode; // 'login' | 'register'
const kotakError = document.getElementById('authError');
const teksError = document.getElementById('authErrorText') || kotakError;
const tombol = document.getElementById('submitBtn');
const tos = document.getElementById('tos');

// Hanya izinkan tujuan di situs ini sendiri (cegah open redirect)
const tujuanMentah = new URLSearchParams(location.search).get('next') || '';
const tujuan = /^\/(?!\/)/.test(tujuanMentah) ? tujuanMentah : '/dashboard';

function tampilError(pesan) {
  teksError.textContent = pesan;
  kotakError.hidden = false;
}
function sembunyikanError() {
  kotakError.hidden = true;
}

// Sudah masuk? Langsung ke dashboard
api('/auth/me')
  .then(({ user }) => user && location.replace(tujuan))
  .catch(() => {});

// Tombol lihat / sembunyikan sandi
document.querySelectorAll('[data-toggle]').forEach((btn) => {
  btn.addEventListener('click', () => {
    const input = document.getElementById(btn.dataset.toggle);
    const lihat = input.type === 'password';
    input.type = lihat ? 'text' : 'password';
    btn.textContent = lihat ? 'Tutup' : 'Lihat';
    btn.setAttribute('aria-label', lihat ? 'Sembunyikan kata sandi' : 'Tampilkan kata sandi');
  });
});

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  sembunyikanError();
  const data = dataForm(form);

  if (!data.email || !data.password) return tampilError('Email dan kata sandi wajib diisi.');
  if (mode === 'register') {
    if (!data.name || data.name.trim().length < 2) return tampilError('Nama minimal 2 karakter.');
    if (data.password.length < 8) return tampilError('Kata sandi minimal 8 karakter.');
    if (data.password !== data.password2) return tampilError('Ulangi kata sandi belum sama.');
    if (!tos.checked) return tampilError('Centang persetujuan dulu ya.');
  }

  try {
    await sambilMemuat(tombol, () =>
      api(`/auth/${mode}`, {
        method: 'POST',
        body: mode === 'register' ? { name: data.name, email: data.email, password: data.password } : data,
      }),
    );
    location.href = tujuan;
  } catch (error) {
    tampilError(error.message);
  }
});

// ---------------------------------------------------------------------------
// Masuk dengan Google (hanya kalau GOOGLE_CLIENT_ID diisi di server)
// ---------------------------------------------------------------------------

async function pasangGoogle() {
  const { googleClientId } = await api('/auth/config');
  if (!googleClientId) return;

  await new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://accounts.google.com/gsi/client';
    s.async = true;
    s.onload = resolve;
    s.onerror = reject;
    document.head.append(s);
  });

  const wadah = document.getElementById('gsiButton');
  document.getElementById('googleBox').hidden = false;

  window.google.accounts.id.initialize({
    client_id: googleClientId,
    callback: async ({ credential }) => {
      sembunyikanError();
      try {
        await api('/auth/google', { method: 'POST', body: { credential } });
        location.href = tujuan;
      } catch (error) {
        tampilError(error.message);
      }
    },
  });

  const gambar = () => {
    wadah.innerHTML = '';
    const lebar = Math.min(360, Math.max(220, Math.floor(wadah.offsetWidth)));
    window.google.accounts.id.renderButton(wadah, {
      theme: 'filled_black',
      size: 'large',
      width: lebar,
      text: mode === 'register' ? 'signup_with' : 'continue_with',
      shape: 'pill',
    });
  };
  gambar();

  // Di halaman daftar, tombol Google baru aktif setelah persetujuan dicentang
  if (tos) {
    const sinkron = () => wadah.classList.toggle('disabled', !tos.checked);
    tos.addEventListener('change', sinkron);
    sinkron();
  }

  let jeda;
  window.addEventListener('resize', () => {
    clearTimeout(jeda);
    jeda = setTimeout(gambar, 250);
  });
}

pasangGoogle().catch(() => {
  // Google tidak bisa dimuat: login dengan email tetap jalan
});

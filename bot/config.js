/*
 Pengaturan bot untuk SATU server VaresaJasher.

 File ini tidak perlu diubah. Setiap server punya pengaturannya sendiri yang
 diatur dari dashboard web, lalu dikirim ke proses bot lewat variabel
 lingkungan VJ_BOT_CONFIG (JSON) saat bot dinyalakan oleh src/bot-manager.js.
 Nilai di bawah hanya cadangan kalau ada yang tidak diisi.
*/

const bawaan = {
  // Nomor yang boleh menyuruh bot. Nomor bot itu sendiri SELALU boleh
  // (pesan dari HP pemilik = fromMe), jadi daftar ini untuk owner tambahan.
  nomorOwner: [],

  // Awalan perintah. Contoh: .menu atau #menu. Tanpa awalan juga tetap bisa.
  prefix: ['.', '#'],

  // Identitas bot (muncul di menu & ping)
  namaBot: 'VaresaJasher',
  versi: '1.0',

  // Jeda DETIK antar pengiriman ke tiap grup / kontak. Jangan di bawah 5.
  jedaKirim: 15,

  autojpm: {
    tagSemua: false, // true = tag semua anggota grup saat autojpm
    jedaPutaran: 1400, // jeda DETIK sebelum autojpm mengulang
  },

  // Penyimpanan gambar AUTOJPM di GitHub (opsional, diisi lewat env server web).
  github: {
    token: '',
    username: '',
    repo: '',
    branch: 'main',
  },

  // Lokasi sesi login, relatif terhadap folder server (process.cwd()).
  fileSesi: 'sessions/whatsapp.sqlite',

  // 'production' = kirim sungguhan, 'development' = uji coba (tidak dikirim)
  mode: 'production',

  // Cara login kalau sesi belum ada: { metode: 'pairing', nomor: '628xxx' } atau { metode: 'qr' }
  login: { metode: '', nomor: '' },
};

function bacaDariEnv() {
  try {
    return JSON.parse(process.env.VJ_BOT_CONFIG || '{}');
  } catch {
    console.error('VJ_BOT_CONFIG bukan JSON yang valid, memakai pengaturan bawaan.');
    return {};
  }
}

const dariWeb = bacaDariEnv();

const config = {
  ...bawaan,
  ...dariWeb,
  autojpm: { ...bawaan.autojpm, ...(dariWeb.autojpm ?? {}) },
  github: { ...bawaan.github, ...(dariWeb.github ?? {}) },
  login: { ...bawaan.login, ...(dariWeb.login ?? {}) },
};

config.nomorOwner = (config.nomorOwner ?? []).map((n) => String(n).replace(/\D/g, '')).filter(Boolean);
if (!Array.isArray(config.prefix) || !config.prefix.length) config.prefix = bawaan.prefix;

export default config;

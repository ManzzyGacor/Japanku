# VaresaJasher — catatan proyek untuk sesi Claude berikutnya

Website jadibot JPM/jasher WhatsApp milik ManzzyID (saudara dari JadiVaresa, varesa.mom).
Bahasa UI, komentar, dan nama variabel: **Bahasa Indonesia** (ikuti gaya ini).

## Arsitektur

- `src/server.js` — Express 5, melayani `public/` (HTML/CSS/JS statis, tanpa build) dan `/api`.
- `src/db.js` — better-sqlite3, migrasi berupa array `MIGRASI` (tambah elemen baru, jangan ubah yang lama).
  Tabel: users, sessions, packages, servers, transactions, topups, settings. Uang = integer rupiah.
  Saldo hanya boleh diubah lewat `ubahSaldo()` (mencatat mutasi) di dalam `db.transaction`.
- `src/auth.js` — scrypt bawaan Node, sesi = token acak di cookie `vj_session` (DB menyimpan sha256-nya).
  CSRF: semua request non-GET ke `/api` WAJIB `Content-Type: application/json` (`wajibJson`).
- `src/bot-manager.js` — **1 server = 1 proses anak** `bot/worker.js` (child_process.fork), cwd =
  `storage/servers/<id>`, config lewat env `VJ_BOT_CONFIG`. Bot mengirim log/status/pairing/qr lewat IPC
  (`bot/lib/ipc.js`). Kode keluar: 0 normal, 1 error (restart otomatis dengan backoff), 3 logout (sesi
  dihapus, nomor dilepas). Aturan **1 nomor = 1 server**: `servers.phone` UNIQUE + cek `sedangDipairing()`.
- `bot/` — script JPM Autoresbot (zapo-js) yang diadaptasi: tanpa prompt terminal, plugin dimuat relatif
  ke file, token GitHub hanya dari env. `bot/simulasi.js` dipakai saat `BOT_SIMULASI=1`.
- Frontend dashboard = SPA hash-router (`public/assets/js/app.js`, view di `views/`). Pakai tag
  `html\`\`` dari `lib.js` (auto-escape) untuk semua data pengguna. Listener dipasang pada pembungkus
  per halaman, bukan `#view`, supaya hilang saat pindah halaman.

## Menjalankan & menguji

- `cp .env.example .env`, isi `ADMIN_EMAILS`, `npm start` (port 3000).
- `npm run dev` = mode simulasi + auto-reload; alur pairing bisa dites tanpa nomor WhatsApp.
- Belum ada test suite otomatis. Uji manual: curl ke `/api` (wajib header JSON) atau Playwright
  (Chromium di `/opt/pw-browsers` pada container cloud).
- Mode nyata (tanpa simulasi) sudah dites sampai QR WhatsApp asli muncul di dashboard.

## Status & rencana berikutnya

Sudah (inti):
- Desain "Pusat Siaran" (base.css/landing/auth/app + halaman /harga /faq /panduan /syarat /privasi),
  URL bersih tanpa .html (src/halaman.js), dashboard SPA History API.
- Paket bertingkat: Antena 7k / Menara 12k / Satelit 15k (kode di packages.code), trial 'uji' active=0.
- Pembayaran QRIS AutoGopay (src/payment.js klien, src/pembayaran.js domain, src/toko.js beli/perpanjang
  bersama). Top up/beli/perpanjang via QRIS; webhook HMAC body mentah (dipasang SEBELUM express.json);
  1 tagihan/user; hangus 5 menit; penyapu; mode simulasi AUTOGOPAY_SIMULASI=1.
- Free trial Uji Sinyal (src/trial.js, routes/trial.js): 1/akun, 1/NOMOR WA selamanya (src/nomor.js
  ledger, dicatat tiap pairing lewat manager.onPairing hook), sinyal lunak IP/perangkat (src/ip.js,
  src/antiabuse.js), kill switch + admin /api/admin/trial.
- Keamanan akun: admin via ADMIN_EMAILS hanya kalau email terverifikasi; login Google aman dari
  ambil-alih (hapus sandi+sesi akun sandi belum terverifikasi).
- Batas sumber daya per tier (src/tiers.js): memori heap (--max-old-space-size) + nice CPU per paket.
  CPU hard-cap per bot TIDAK dipakai (di panel batas berlaku se-kontainer).
- Lama: dashboard server, pairing code/QR, terminal, pengaturan bot, top up manual, panel admin, CLI.

Belum (kandidat berikutnya):
- Frontend: tombol "Coba gratis" (POST /api/trial/claim) di dashboard, tampilan server trial + countdown,
  verifikasi email (SMTP belum ada), halaman invoice QRIS kalau belum rampung agent.
- Kirim JPM / whitelist / AutoJPM langsung dari dashboard (sekarang lewat perintah chat).
- Lupa kata sandi, notifikasi masa aktif hampir habis, voucher/referral.
- Log bot hanya di memori (400 baris/server), hilang saat restart.

## Migrasi DB (append-only, jangan ubah yang lama)
MIGRASI[0] skema awal · [1] packages.code+size_label (tier) · [2] invoices (QRIS) ·
[3] keamanan akun (users.email_verified_at/email_canonical/signup_*), servers.is_trial,
nomor_riwayat, trial_claims, security_events, paket 'uji'.

## Peringatan

- Zip script asli yang dikirim pengguna berisi token GitHub ter-hardcode — sudah dibuang dari kode;
  jangan pernah menulis token/kredensial di repo.
- README script asli Autoresbot menyebut "tidak boleh diperjualbelikan"; pengguna sudah diingatkan.

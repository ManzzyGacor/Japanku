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

Sudah: landing, login/daftar (+Google opsional), dashboard server, beli/perpanjang, pairing code & QR,
terminal langsung, pengaturan bot dari web, saldo + top up manual, panel admin, alat CLI `npm run admin`.

Belum (kandidat langkah berikutnya):
- Payment gateway QRIS otomatis (mis. Pakasir/Tripay/Midtrans) menggantikan top up manual.
- Kirim JPM / kelola whitelist & AutoJPM langsung dari dashboard (sekarang lewat perintah chat).
- Lupa kata sandi via email, notifikasi masa aktif hampir habis, voucher / referral, paket gratis.
- Log bot hanya di memori (400 baris/server), hilang saat website restart.

## Peringatan

- Zip script asli yang dikirim pengguna berisi token GitHub ter-hardcode — sudah dibuang dari kode;
  jangan pernah menulis token/kredensial di repo.
- README script asli Autoresbot menyebut "tidak boleh diperjualbelikan"; pengguna sudah diingatkan.

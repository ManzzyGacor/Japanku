# VaresaJasher

Website **jadibot JPM / jasher** untuk WhatsApp. Pengguna membuat akun, mengisi saldo,
membeli server, lalu menghubungkan nomor WhatsApp-nya lewat **pairing code** atau **scan QR**
langsung dari dashboard. Setelah tersambung, nomor itu menjadi bot JPM (script JPM
Autoresbot) yang berjalan 24 jam di server kamu.

- **1 server = 1 nomor WhatsApp.** Satu akun boleh membeli server sebanyak apa pun.
- Satu nomor tidak bisa dipakai di dua server sekaligus (dicek sebelum pairing dan dikunci di database).
- Tiap server punya proses bot dan datanya sendiri (sesi, whitelist, postingan AutoJPM).

## Fitur website

| Bagian | Isi |
| --- | --- |
| Halaman utama | Penjelasan, cara kerja, fitur, harga (otomatis dari paket admin), tanya jawab |
| Masuk / Daftar | Email + kata sandi, opsional **Masuk dengan Google** |
| Server saya | Daftar server beserta status online, nomor, dan masa aktif |
| Detail server | Hubungkan nomor (pairing code / QR), nyala-matikan, lepas nomor, perpanjang, **terminal langsung**, pengaturan bot (pengganti `config.js`), hapus server |
| Beli server | Pilih paket, bayar pakai saldo |
| Saldo & top up | Instruksi pembayaran + QRIS, kirim permintaan top up, riwayat & mutasi saldo |
| Akun | Ganti nama & kata sandi |
| Panel admin | Ringkasan, terima/tolak top up, kelola pengguna (saldo, admin, nonaktifkan), semua server (± hari, matikan/nyalakan), paket & harga, pengaturan situs |

## Perintah bot

Dikirim dari chat WhatsApp nomor bot itu sendiri (misalnya chat ke diri sendiri) atau dari
nomor *owner tambahan* yang diatur di dashboard. Awali dengan prefix, contoh `.menu`.

`menu`, `ping`, `listgc`, `jpm <pesan>`, `jpmtag <pesan>`, `autojpm`, `autojpm list|stop|del`,
`autoreply <pesan>|stop`, `whitelist`, `addwhitelist`,
`delwhitelist`, `resetdata`.

## Instalasi (VPS)

Butuh **Node.js 20.9+** (disarankan 22).

```bash
git clone https://github.com/ManzzyGacor/Japanku.git varesajasher
cd varesajasher
npm install
cp .env.example .env
nano .env          # minimal isi ADMIN_EMAILS dengan email kamu
npm start
```

Buka `http://IP-VPS:3000`, lalu **daftar memakai email yang ada di `ADMIN_EMAILS`** —
akun itu otomatis jadi admin dan menu *Panel admin* muncul di dashboard.

Langkah pertama sebagai admin:

1. Panel admin › **Pengaturan**: isi instruksi pembayaran (nomor DANA/OVO/rekening), URL gambar QRIS, nomor WhatsApp admin.
2. Panel admin › **Paket**: atur nama, durasi, dan harga paket.
3. Coba alurnya: Saldo › top up, lalu terima di Panel admin › Top up, lalu Beli server.

### Supaya jalan terus (pm2)

```bash
npm install -g pm2
pm2 start index.js --name varesajasher
pm2 save && pm2 startup
```

Bot yang sedang aktif otomatis dinyalakan lagi setiap website di-restart.

### Domain + HTTPS (Nginx)

```nginx
server {
    server_name jasher.domainkamu.com;
    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

Lalu pasang sertifikat (`certbot --nginx`) dan di `.env` isi `TRUST_PROXY=1` serta
`BASE_URL=https://jasher.domainkamu.com`.

### Panel Pterodactyl

Bisa juga, selama RAM panel cukup: sekitar **150 MB per bot** yang online + ±130 MB untuk website
(hasil ukur; bisa naik kalau grupnya sangat banyak). Contoh: 10 bot online ≈ 1,7 GB RAM.
Upload semua file, isi `.env`, startup file `index.js`. Port otomatis memakai `SERVER_PORT` dari panel.

## Mencoba tanpa nomor WhatsApp

Isi `BOT_SIMULASI=1` di `.env` (atau jalankan `npm run dev`). Bot tidak tersambung ke WhatsApp:
kode pairing / QR palsu muncul, lalu server "tersambung" beberapa detik kemudian. Cocok untuk
mengecek tampilan website. **Jangan lupa kembalikan ke `0` untuk dipakai sungguhan.**

## Alat admin dari terminal

```bash
npm run admin -- jadikan-admin email@kamu.com
npm run admin -- saldo email@kamu.com 50000      # angka negatif = kurangi
npm run admin -- sandi email@kamu.com SandiBaru123
npm run admin -- daftar
```

## Struktur folder

```
index.js              titik awal (memanggil src/server.js)
src/
  server.js           server web Express: halaman + API
  env.js              membaca .env
  db.js               database SQLite (users, servers, packages, topups, ...)
  auth.js             kata sandi, sesi login, pembatas percobaan
  bot-manager.js      menyalakan 1 proses bot per server, status, log, aturan 1 nomor
  routes/             API: auth, akun & saldo, servers, admin
bot/                  script JPM, dijalankan per server oleh bot-manager
  worker.js           titik awal 1 bot
  simulasi.js         bot pura-pura untuk BOT_SIMULASI=1
  config.js           pengaturan bot (dikirim dari dashboard)
  lib/ plugins/       mesin bot & perintah (1 file = 1 perintah)
public/               halaman web (HTML, CSS, JS tanpa build)
scripts/admin.js      alat admin dari terminal
storage/              DIBUAT OTOMATIS: database + data tiap server (jangan di-push)
```

Cadangkan folder `storage/` secara berkala — isinya database dan sesi WhatsApp semua pengguna.

## Tips supaya nomor tidak kena banned

- Pakai nomor cadangan khusus jualan, bukan nomor utama.
- Naikkan *jeda kirim* kalau grupnya banyak (default 15 detik).
- Coba dulu dengan mode *Uji coba* di pengaturan bot.

## Kredit

Mesin bot berasal dari script JPM open source [Autoresbot](https://autoresbot.com)
(github.com/autoresbot/resbot-jpm), memakai library [zapo-js](https://zapo.to).

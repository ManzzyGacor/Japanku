/*
 Titik awal SATU bot VaresaJasher.

 File ini tidak dijalankan manual: src/bot-manager.js menjalankannya sebagai
 proses anak untuk setiap server yang aktif, dengan:
   - cwd            = folder data server itu (storage/servers/<id>)
   - VJ_BOT_CONFIG  = pengaturan server dari dashboard (JSON)
   - VJ_SERVER_ID   = id server

 Jadi satu server = satu proses = satu nomor WhatsApp, dan data tiap server
 (sesi, whitelist, postingan autojpm, gambar) terpisah satu sama lain.

 Berdasarkan script JPM Autoresbot (https://autoresbot.com) - open source.
*/

if (process.env.BOT_SIMULASI === '1') {
  // Mode simulasi: tidak tersambung ke WhatsApp sama sekali, hanya pura-pura
  // pairing supaya alur website bisa dicoba tanpa nomor sungguhan.
  await import('./simulasi.js');
} else {
  const { default: config } = await import('./config.js');
  const { log } = await import('./lib/logger.js');
  const { startBot } = await import('./lib/whatsapp.js');
  const { resumeAutoJPM } = await import('./lib/autojpm.js');
  const { modeUjiCoba } = await import('./lib/mode.js');

  log(`Start ${config.namaBot} v${config.versi} (server #${process.env.VJ_SERVER_ID ?? '-'})`);

  if (modeUjiCoba()) {
    log('MODE UJI COBA aktif - pesan massal TIDAK dikirim, hanya dicatat di terminal.', 'yellow');
  }

  process.on('unhandledRejection', (error) => {
    log(`Kesalahan tak tertangani: ${error?.message ?? error}`, 'red');
  });

  startBot((client) => {
    // Dijalankan setiap koneksi berhasil terbuka
    resumeAutoJPM(client);
  }).catch((error) => {
    log(`Gagal menjalankan bot: ${error.message}`, 'red');
    process.exit(1);
  });
}

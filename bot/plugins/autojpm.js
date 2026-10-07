import { startAutoJPM, stopAutoJPM, isAutoJPMRunning, putaranSaatIni } from '../lib/autojpm.js';
import { tambahDariPesan, hapusSaluran, daftarSaluran, pilihSumber } from '../lib/jpmSaluran.js';
import { catatanMode } from '../lib/mode.js';

const PANDUAN = `*ᴄᴀʀᴀ ᴘᴇɴɢɢᴜɴᴀᴀɴ*
Forward/kirim postingannya (teks+gambar) ke chat ini, lalu kirim pesan BARU:

➽ autojpm [label]       -> ambil postingan itu + langsung mulai
➽ autojpm add [label]   -> ambil postingan itu (tanpa mulai)
➽ autojpm del <nomor>   -> hapus (nomor dari *autojpm list*)
➽ autojpm list          -> status, daftar postingan & jumlah terkirim
➽ autojpm start         -> mulai (kalau sudah nambah tapi belum jalan)
➽ autojpm stop          -> hentikan

_Bisa juga: kirim gambarnya langsung dengan caption *autojpm*._
⚠️ Jangan pakai *reply* kalau postingannya ada gambar — gambar dari pesan yang di-reply tidak bisa diunduh.

Semua postingan yang terdaftar dikirim LANGSUNG (berurutan) ke tiap grup, baru pindah grup berikutnya. Setelah semua grup kebagian, jeda putaran diatur di config.js (autojpm.jedaPutaran, dalam detik).`;

function formatDaftar(daftar, running, putaran) {
  const header = `╭───❰  *AUTOJPM*  ❱
│ Status : ${running ? '🟢 BERJALAN' : '🔴 BERHENTI'}${running ? `\n│ Putaran ke : ${putaran}` : ''}
│ Total postingan : ${daftar.length}
╰───────────❱`;

  if (!daftar.length) {
    return `${header}

Belum ada postingan. Kirim postingannya ke chat ini, lalu ketik: *autojpm*`;
  }

  const baris = daftar
    .map((s, i) => {
      const gambar = s.imageUrl ? 'GitHub + folder' : s.imagePath ? 'folder' : 'tidak ada';
      return `
◆ *${i + 1}. ${s.nama}*
┇ Terkirim : ${s.terkirim ?? 0}x
┇ Gambar : ${gambar}
┇ Badge channel : ${s.infoSaluran ? `ada (${s.infoSaluran.newsletterName ?? 'tanpa nama'})` : 'tidak ada'}`;
    })
    .join('\n');

  return `${header}
${baris}

Hapus dengan: *autojpm del 1* (nomor dari daftar ini)`;
}

/** Laporan setelah sebuah postingan berhasil ditambahkan */
function laporTambah(hasil, asal) {
  const { item } = hasil;
  const cuplikan = item.text ? `\n📝 "${item.text.split('\n')[0].slice(0, 50)}"` : '';

  let statusGambar;
  if (hasil.gambarGagal) statusGambar = `\n⚠️ Gambar GAGAL diunduh (${hasil.alasanGambar}) — tersimpan teksnya saja.`;
  else if (item.imageUrl) statusGambar = '\n🖼️ Gambar tersimpan di folder + GitHub.';
  else if (item.imagePath) statusGambar = '\n🖼️ Gambar tersimpan di folder.';
  else statusGambar = '\n🖼️ Tanpa gambar (teks saja).';

  return `✅ *${item.nama}* ditambahkan.\n📍 Diambil dari: ${asal}${cuplikan}${statusGambar}`;
}

export default async function autojpm({ client, event, pesanSebelumnya, body, reply }) {
  const kata = body ? body.split(/\s+/).filter(Boolean) : [];
  const subLower = (kata[0] ?? '').toLowerCase();
  const sisa = kata.slice(1).join(' ').trim();

  if (subLower === 'stop') {
    if (!isAutoJPMRunning()) return reply('❌ AutoJPM tidak sedang berjalan.');
    stopAutoJPM();
    return reply('🛑 AutoJPM telah dihentikan.');
  }

  if (subLower === 'list') {
    return reply(formatDaftar(daftarSaluran(), isAutoJPMRunning(), putaranSaatIni()));
  }

  if (subLower === 'del' || subLower === 'dellink') {
    if (!sisa) return reply('❌ Sertakan nomor yang mau dihapus. Lihat nomornya di *autojpm list*.');
    const hasil = hapusSaluran(sisa);
    if (!hasil.ok) return reply('❌ Nomor tidak ditemukan.');
    return reply(`🗑️ *${hasil.item.nama}* dihapus.`);
  }

  if (subLower === 'start') {
    if (isAutoJPMRunning()) return reply('⚠️ AutoJPM sudah berjalan. Ketik *autojpm stop* untuk menghentikan.');
    if (!daftarSaluran().length) return reply('❌ Belum ada postingan. Kirim postingannya, lalu ketik *autojpm add*.');

    await reply('▶️ Memulai AutoJPM ...');
    await startAutoJPM(client, { kabari: reply });
    return reply(`✅ AutoJPM selesai atau dihentikan.${catatanMode()}`);
  }

  // Sisanya: menambah postingan
  const modeAdd = subLower === 'add' || subLower === 'addlink';
  const label = modeAdd ? sisa : body;

  const pilihan = pilihSumber(event, pesanSebelumnya);
  if (!pilihan) return reply(PANDUAN);

  const hasil = await tambahDariPesan(client, pilihan, label);
  if (!hasil.ok) return reply(`❌ ${hasil.alasan}`);

  const laporan = laporTambah(hasil, pilihan.asal);

  if (modeAdd) {
    return reply(`${laporan}${isAutoJPMRunning() ? '' : '\n\nKetik *autojpm start* untuk mulai kirim.'}`);
  }

  if (isAutoJPMRunning()) return reply(`${laporan}\n\nIkut mulai putaran berikutnya.`);

  await reply(`${laporan}\n\n▶️ Memulai AutoJPM ...`);
  await startAutoJPM(client, { kabari: reply });
  return reply(`✅ AutoJPM selesai atau dihentikan.${catatanMode()}`);
}

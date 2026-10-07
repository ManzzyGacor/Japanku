import fs from 'fs';
import path from 'path';
import { log } from './logger.js';
import { FILE_JPM_SALURAN, DIR_JPM_SALURAN_MEDIA, ensureDataDir } from './paths.js';
import { githubSiap, unggahGambar, hapusGambar } from './githubStore.js';

function bacaSemua() {
  try {
    if (!fs.existsSync(FILE_JPM_SALURAN)) return [];
    const data = JSON.parse(fs.readFileSync(FILE_JPM_SALURAN, 'utf8'));
    return Array.isArray(data) ? data : [];
  } catch (error) {
    log(`Gagal membaca jpm-saluran.json: ${error.message}`, 'red');
    return [];
  }
}

function simpanSemua(daftar) {
  ensureDataDir();
  fs.writeFileSync(FILE_JPM_SALURAN, JSON.stringify(daftar, null, 2));
}

function ekstrakTeks(message) {
  return (
    message?.conversation ??
    message?.extendedTextMessage?.text ??
    message?.imageMessage?.caption ??
    message?.videoMessage?.caption ??
    ''
  );
}

/** contextInfo bisa nempel di berbagai jenis pesan (teks, gambar, video, dst) */
function ekstrakContextInfo(message) {
  return (
    message?.extendedTextMessage?.contextInfo ??
    message?.imageMessage?.contextInfo ??
    message?.videoMessage?.contextInfo ??
    message?.documentMessage?.contextInfo ??
    null
  );
}

/**
 * Kalau pesan ini di-forward dari sebuah WhatsApp Channel, WhatsApp menyisipkan info
 * channel-nya di contextInfo.forwardedNewsletterMessageInfo. Dipakai supaya broadcast-nya
 * bisa bawa badge "Forwarded - Nama Channel".
 */
function ekstrakInfoSaluran(message) {
  const info = ekstrakContextInfo(message)?.forwardedNewsletterMessageInfo;
  if (!info) return null;

  return {
    newsletterJid: info.newsletterJid ?? null,
    newsletterName: info.newsletterName ?? null,
    serverMessageId: info.serverMessageId ?? null,
  };
}

/** Pesan yang di-reply, HANYA untuk diambil teks/infonya (gambarnya tidak bisa diunduh) */
function ambilKutipan(event) {
  const ctx = ekstrakContextInfo(event?.message);
  if (!ctx?.quotedMessage) return null;
  return { key: { remoteJid: event.key?.remoteJid, id: ctx.stanzaId }, message: ctx.quotedMessage };
}

/**
 * Tentukan pesan mana yang jadi sumber postingan.
 *
 * PENTING: gambar hanya bisa diunduh dari event ASLI yang dikirim zapo
 * (pesan yang baru masuk). Pesan hasil reply/kutipan TIDAK bisa diunduh
 * gambarnya -- zapo menolak dengan "message has no downloadable media" --
 * jadi sumber reply ditandai bolehUnduh: false.
 *
 * Urutan prioritas:
 *   1. gambar nempel di perintahnya sendiri (kirim gambar + caption ".autojpm")
 *   2. pesan yang di-reply (teks saja)
 *   3. pesan sebelumnya di chat ini (event asli -> gambarnya bisa diunduh)
 */
export function pilihSumber(event, pesanSebelumnya) {
  if (event?.message?.imageMessage) {
    return { sumber: event, asal: 'caption perintah', bolehUnduh: true };
  }

  const kutipan = ambilKutipan(event);
  if (kutipan) {
    return { sumber: kutipan, asal: 'pesan yang di-reply', bolehUnduh: false };
  }

  if (pesanSebelumnya) {
    return { sumber: pesanSebelumnya, asal: 'pesan sebelumnya di chat ini', bolehUnduh: true };
  }

  return null;
}

/**
 * Unduh gambar ke folder data/jpm-saluran-media/ pakai cara yang sama dengan
 * plugin jpm (client.message.downloadToFile pada event asli) -- cara ini sudah
 * terbukti jalan, termasuk di panel.
 */
async function unduhKeFolder(client, sumber, id) {
  ensureDataDir();
  fs.mkdirSync(DIR_JPM_SALURAN_MEDIA, { recursive: true });

  const tujuan = path.join(DIR_JPM_SALURAN_MEDIA, `${id}.jpg`);
  await client.message.downloadToFile(sumber, tujuan);

  if (!fs.existsSync(tujuan) || fs.statSync(tujuan).size === 0) {
    fs.rmSync(tujuan, { force: true });
    throw new Error('file hasil unduhan kosong');
  }

  return tujuan;
}

/** Daftar semua postingan yang dipantau AUTOJPM */
export function daftarSaluran() {
  return bacaSemua();
}

/**
 * Tambah satu postingan baru dari hasil pilihSumber().
 * Mengembalikan { ok: true, item, gambarGagal, alasanGambar } atau { ok: false, alasan }.
 */
export async function tambahDariPesan(client, pilihan, catatan = '') {
  if (!pilihan?.sumber) return { ok: false, alasan: 'Tidak ada pesan sumber.' };

  const { sumber, asal, bolehUnduh } = pilihan;
  const text = ekstrakTeks(sumber.message).trim();
  const adaGambar = Boolean(sumber.message?.imageMessage);

  // --- DEBUG: bantu lacak masalah unduh gambar / badge channel ---
  const jenisPesan = Object.keys(sumber.message ?? {}).join(', ') || '(kosong)';
  const ctx = ekstrakContextInfo(sumber.message);
  log(
    `AUTOJPM debug -> asal: ${asal} | jenis pesan: ${jenisPesan} | adaGambar: ${adaGambar} | ada contextInfo: ${Boolean(ctx)} | keys contextInfo: ${ctx ? Object.keys(ctx).join(', ') : '-'}`,
    'yellow',
  );
  if (ctx) {
    log(`AUTOJPM debug -> forwardedNewsletterMessageInfo: ${JSON.stringify(ctx.forwardedNewsletterMessageInfo ?? null)}`, 'yellow');
  }
  // --- akhir debug ---

  if (!text && !adaGambar) {
    return { ok: false, alasan: 'Pesan itu tidak punya teks atau gambar yang bisa diambil.' };
  }

  // Gambar di pesan yang di-reply tidak bisa diunduh -> minta cara lain,
  // daripada diam-diam menyimpan teksnya saja.
  if (adaGambar && !bolehUnduh) {
    return {
      ok: false,
      alasan:
        'Gambar dari pesan yang di-*reply* tidak bisa diunduh.\n\nPakai salah satu cara ini:\n• Forward/kirim postingannya ke chat ini, lalu kirim pesan baru: *autojpm*\n• Atau kirim gambarnya langsung dengan caption: *autojpm*',
    };
  }

  const id = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
  const infoSaluran = ekstrakInfoSaluran(sumber.message);

  let imagePath = null;
  let imageUrl = null;
  let gambarGagal = false;
  let alasanGambar = null;

  if (adaGambar) {
    try {
      imagePath = await unduhKeFolder(client, sumber, id);
      log(`AUTOJPM debug -> unduh ke folder BERHASIL: ${imagePath}`, 'yellow');
    } catch (error) {
      gambarGagal = true;
      alasanGambar = error.message;
      log(`Gagal mengunduh gambar: ${error.message}`, 'red');
      log(`AUTOJPM debug -> detail error unduh: ${error.stack ?? error}`, 'red');
    }

    // Kalau GitHub diatur, gambarnya juga diunggah supaya aman dari reinstall panel.
    // File lokal tetap disimpan sebagai cadangan.
    if (imagePath && githubSiap()) {
      try {
        imageUrl = await unggahGambar(fs.readFileSync(imagePath), 'jpg', `Gambar AUTOJPM ${id}`);
      } catch (error) {
        log(`Unggah ke GitHub gagal, pakai file lokal saja: ${error.message}`, 'yellow');
      }
    }
  }

  const nama =
    catatan.trim() || infoSaluran?.newsletterName || text.split('\n')[0].slice(0, 40) || '(gambar tanpa teks)';
  const item = { id, nama, text, imagePath, imageUrl, infoSaluran, terkirim: 0 };

  const daftar = bacaSemua();
  daftar.push(item);
  simpanSemua(daftar);

  return { ok: true, item, gambarGagal, alasanGambar };
}

/** Hapus satu postingan, berdasarkan nomor urut dari .autojpm list */
export function hapusSaluran(identifier) {
  const daftar = bacaSemua();

  const nomor = Number(identifier.trim());
  const index = Number.isInteger(nomor) ? nomor - 1 : -1;

  if (index < 0 || index >= daftar.length) return { ok: false };

  const [dihapus] = daftar.splice(index, 1);
  simpanSemua(daftar);

  // Bersih-bersih gambarnya (kegagalan tidak dianggap masalah)
  if (dihapus.imagePath) fs.rmSync(dihapus.imagePath, { force: true });
  if (dihapus.imageUrl) hapusGambar(dihapus.imageUrl).catch(() => {});

  return { ok: true, item: dihapus };
}

/** Tambah hitungan "terkirim" untuk satu postingan (dipanggil tiap berhasil broadcast) */
export function tambahHitunganTerkirim(id, jumlah) {
  const daftar = bacaSemua();
  const item = daftar.find((s) => s.id === id);
  if (!item) return;

  item.terkirim = (item.terkirim ?? 0) + jumlah;
  simpanSemua(daftar);
}

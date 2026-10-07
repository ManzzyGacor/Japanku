import config from '../config.js';
import { log } from './logger.js';
import { siapKirim } from './state.js';
import { modeUjiCoba, JEDA_DEV_MS } from './mode.js';
import { unduhDariUrl } from './githubStore.js';

const TIMEOUT_KIRIM = 10000; // 10 detik per pesan

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Jeda antar pengiriman, dari config.jedaKirim (detik) */
export function jedaKirim() {
  if (modeUjiCoba()) return sleep(JEDA_DEV_MS);
  return sleep((config.jedaKirim ?? 5) * 1000);
}

/** Ringkasan isi pesan untuk ditampilkan di terminal */
function ringkasIsi(content) {
  if (typeof content === 'string') return content;
  if (content.type === 'image') return `[gambar] ${content.caption ?? ''}`;
  if (content.type === 'reaction') return `[reaksi ${content.emoji}]`;
  return content.text ?? content.type ?? '[pesan]';
}

/**
 * Susun isi pesan: teks saja, atau gambar + caption.
 * `media` boleh path file lokal ATAU URL (https://raw.githubusercontent.com/...).
 * `infoSaluran` (opsional) menambahkan badge "Forwarded - Nama Channel".
 */
export function buildContent(text, media, infoSaluran = null) {
  const contextInfo = infoSaluran
    ? {
        isForwarded: true,
        forwardingScore: 2,
        forwardedNewsletterMessageInfo: {
          newsletterJid: infoSaluran.newsletterJid,
          newsletterName: infoSaluran.newsletterName,
          serverMessageId: infoSaluran.serverMessageId,
        },
      }
    : undefined;

  if (!media) return { type: 'text', text, ...(contextInfo ? { contextInfo } : {}) };
  return {
    type: 'image',
    media,
    mimetype: 'image/jpeg',
    caption: text,
    ...(contextInfo ? { contextInfo } : {}),
  };
}

/** Kirim satu pesan dengan batas waktu supaya tidak menggantung */
export async function sendMessage(client, to, content, options) {
  if (!siapKirim()) throw new Error('Koneksi WhatsApp sedang terputus');

  // Mode uji coba: tampilkan saja di terminal, jangan kirim ke siapa pun
  if (modeUjiCoba()) {
    const tag = options?.mentions?.length ? ` (tag ${options.mentions.length} orang)` : '';
    const isi = ringkasIsi(content).split('\n')[0].slice(0, 60);
    log(`[DEV] TIDAK DIKIRIM -> ${to} : ${isi}${tag}`, 'yellow');
    return { id: 'mode-development', simulasi: true };
  }

  const kirimDenganBatasWaktu = (isi) => {
    let timer;
    const batasWaktu = new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error('Timeout saat mengirim pesan')), TIMEOUT_KIRIM);
    });
    return Promise.race([client.message.send(to, isi, options), batasWaktu]).finally(() => clearTimeout(timer));
  };

  // Urutan percobaan, dari yang paling lengkap ke yang paling sederhana:
  //   1. apa adanya (gambar via URL + badge saluran)
  //   2. gambar diunduh dulu jadi Buffer, kalau kirim-via-URL tidak didukung
  //   3. tanpa badge saluran, kalau contextInfo yang bikin ditolak
  //   4. teks saja, biar pesan tetap sampai walau gambarnya bermasalah
  const urlGambar = typeof content?.media === 'string' && content.media.startsWith('http') ? content.media : null;

  const rencana = [['apa adanya', async () => content]];

  if (urlGambar) {
    rencana.push([
      'gambar sebagai buffer',
      async () => ({ ...content, media: await unduhDariUrl(urlGambar) }),
    ]);
  }

  if (content?.contextInfo) {
    rencana.push([
      'tanpa badge saluran',
      async () => {
        const { contextInfo, ...sisa } = content;
        return urlGambar ? { ...sisa, media: await unduhDariUrl(urlGambar) } : sisa;
      },
    ]);
  }

  if (content?.type === 'image' && content.caption) {
    rencana.push(['teks saja', async () => ({ type: 'text', text: content.caption })]);
  }

  let terakhir;
  for (const [nama, susun] of rencana) {
    try {
      const isi = await susun();
      const hasil = await kirimDenganBatasWaktu(isi);
      if (nama !== 'apa adanya') log(`Terkirim dengan cara cadangan: ${nama}.`, 'yellow');
      return hasil;
    } catch (error) {
      terakhir = error;
      log(`Kirim (${nama}) gagal: ${error.message}`, 'yellow');
    }
  }

  throw terakhir ?? new Error('Gagal mengirim pesan');
}

/**
 * Kirim BEBERAPA postingan ke tiap grup secara berurutan: satu grup menerima
 * semua postingan dulu (langsung, tanpa jeda), baru bot pindah ke grup
 * berikutnya (dengan jeda jedaKirim seperti biasa).
 *
 * @param {object} client
 * @param {Array}  groups   hasil getTargetGroups()
 * @param {Array}  posts    [{ id, text, imagePath, imageUrl, infoSaluran }, ...]
 * @param {object} opsi
 * @param {boolean}[opsi.tagAll] tag semua anggota grup
 * @param {string} [opsi.label]  label untuk log, mis. 'AUTOJPM'
 * @param {Function}[opsi.isCancelled] dipanggil tiap grup; true = berhenti
 * @returns {Promise<Map<string, number>>} id postingan -> jumlah grup yang berhasil dikirimi
 */
export async function broadcastMultiToGroups(client, groups, posts, opsi = {}) {
  const { tagAll = false, label = 'JPM', isCancelled } = opsi;
  const hasil = new Map(posts.map((p) => [p.id, 0]));

  let nomor = 1;
  for (const group of groups) {
    if (isCancelled?.()) break;
    if (!siapKirim()) {
      log('Koneksi terputus - pengiriman dihentikan.', 'red');
      break;
    }

    const mentions = tagAll ? group.participants.map((p) => p.jid) : [];
    log(`${label} [${nomor}/${groups.length}] Kirim ${posts.length} postingan ke grup: ${group.name}`);

    for (const pos of posts) {
      if (isCancelled?.()) break;

      const content = buildContent(pos.text, pos.imageUrl ?? pos.imagePath, pos.infoSaluran);
      try {
        await sendMessage(client, group.id, content, mentions.length ? { mentions } : undefined);
        hasil.set(pos.id, (hasil.get(pos.id) ?? 0) + 1);
      } catch (error) {
        log(`Gagal mengirim "${pos.nama}" ke ${group.name}: ${error.message}`, 'red');
      }
    }

    await jedaKirim();
    nomor += 1;
  }

  return hasil;
}

/**
 * Kirim satu pesan ke banyak grup, satu per satu dengan jeda.
 *
 * @param {object} client        client WhatsApp
 * @param {Array}  groups        hasil getTargetGroups()
 * @param {object} opsi
 * @param {string} opsi.text     isi pesan
 * @param {string} [opsi.imagePath] path gambar lokal (opsional)
 * @param {string} [opsi.imageUrl]  URL gambar, mis. dari GitHub (dipakai lebih dulu)
 * @param {object} [opsi.infoSaluran] info channel asal (opsional) -> badge "Forwarded - Channel"
 * @param {boolean}[opsi.tagAll] tag semua anggota grup
 * @param {string} [opsi.label]  label untuk log, mis. 'AUTOJPM'
 * @param {Function}[opsi.isCancelled] dipanggil tiap grup; true = berhenti
 * @returns {Promise<number>} jumlah grup yang berhasil dikirimi
 */
export async function broadcastToGroups(client, groups, opsi = {}) {
  const {
    text,
    imagePath = null,
    imageUrl = null,
    infoSaluran = null,
    tagAll = false,
    label = 'JPM',
    isCancelled,
  } = opsi;
  const content = buildContent(text, imageUrl ?? imagePath, infoSaluran);
  let terkirim = 0;
  let nomor = 1;

  for (const group of groups) {
    if (isCancelled?.()) break;
    if (!siapKirim()) {
      log('Koneksi terputus - pengiriman dihentikan.', 'red');
      break;
    }

    const mentions = tagAll ? group.participants.map((p) => p.jid) : [];
    log(`${label} [${nomor}/${groups.length}] Kirim ke grup: ${group.name}`);

    try {
      await sendMessage(client, group.id, content, mentions.length ? { mentions } : undefined);
      terkirim += 1;
    } catch (error) {
      log(`Gagal mengirim ke ${group.name}: ${error.message}`, 'red');
    }

    await jedaKirim();
    nomor += 1;
  }

  return terkirim;
}

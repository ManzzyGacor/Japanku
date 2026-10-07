import config from '../config.js';
import { log } from './logger.js';
import { loadPlugins } from './plugins.js';
import { extractGroupLinks, addGroupLinks } from './groupLinks.js';

let commands = {};
const sudahDilog = new Set(); // supaya peringatan nomor tidak spam

/** Hitung jumlah chat per grup, dipakai plugin autoreply */
global.chatCounter = global.chatCounter || {};

/** Pesan terakhir (bukan perintah) di tiap chat -- dipakai plugin autojpm */
global.pesanSebelumnya = global.pesanSebelumnya || {};

export async function initHandler() {
  commands = await loadPlugins();
}

/** Ambil teks dari berbagai jenis pesan */
function extractText(message) {
  return (
    message?.conversation ??
    message?.extendedTextMessage?.text ??
    message?.imageMessage?.caption ??
    message?.videoMessage?.caption ??
    ''
  );
}

/** Pilih JID bentuk nomor telepon kalau tersedia */
function phoneJid(utama, alternatif) {
  return alternatif?.endsWith('@s.whatsapp.net') ? alternatif : utama;
}

function onlyDigits(jid) {
  return jid?.split('@')[0].replace(/\D/g, '') || 'unknown';
}

/** Buang satu karakter awalan (prefix) dari perintah, kalau ada */
function stripPrefix(word) {
  return config.prefix.includes(word.charAt(0)) ? word.slice(1) : word;
}

/** Hanya nomor owner (atau bot itu sendiri) yang boleh memerintah */
function isAllowed(senderNumber, fromMe) {
  if (fromMe || config.nomorOwner.includes(senderNumber)) return true;

  if (!sudahDilog.has(senderNumber)) {
    sudahDilog.add(senderNumber);
    log(`Nomor ${senderNumber} tidak diizinkan untuk chat ke bot.`, 'red');
  }
  return false;
}

/** Kirim balasan tanpa membuat seluruh perintah gagal kalau koneksi bermasalah */
async function kirimAman(client, to, isi) {
  try {
    return await client.message.send(to, isi);
  } catch (error) {
    log(`Gagal mengirim balasan: ${error.message}`, 'red');
    return null;
  }
}

/**
 * Ambil isi pesan setelah kata perintah, APA ADANYA.
 * Hanya pemisah setelah perintah (spasi/tab + maksimal satu ganti baris)
 * yang dibuang, supaya baris baru, spasi ganda, dan indentasi teks tetap utuh.
 */
function sisaPesan(text, firstWord) {
  return text.slice(firstWord.length).replace(/^[ \t]*\r?\n?/, '').trimEnd();
}

/** Dipanggil setiap ada pesan masuk */
export async function handleMessage(client, event) {
  try {
    const key = event.key;
    const from = key.remoteJid;
    if (!from) return;

    const text = extractText(event.message).trim();
    const [firstWord, ...args] = text ? text.split(/\s+/) : [];
    const command = firstWord ? stripPrefix(firstWord).toLowerCase() : '';
    const adaMedia = Boolean(event.message?.imageMessage || event.message?.videoMessage);
    const iniPerintahDikenal = Boolean(command) && Boolean(commands[command]);

    // Simpan pesan ini sebagai "pesan sebelumnya" di chat ini -- KECUALI kalau pesan
    // ini sendiri adalah perintah bot. Dipakai plugin seperti autojpm untuk mengambil
    // postingan (teks/gambar) yang dikirim tepat sebelum perintahnya dijalankan.
    const pesanSebelumnya = global.pesanSebelumnya[from];
    if (!iniPerintahDikenal && (text || adaMedia)) {
      global.pesanSebelumnya[from] = event;
    }

    if (!text) return;

    const isGroup = Boolean(key.isGroup);
    const senderJid = isGroup
      ? phoneJid(key.participant, key.participantAlt)
      : phoneJid(from, key.remoteJidAlt);
    const senderNumber = onlyDigits(senderJid);

    global.chatCounter[from] = global.chatCounter[from] || { total: 0 };
    global.chatCounter[from].total += 1;

    // Kumpulkan link grup yang lewat di chat
    const links = extractGroupLinks(text);
    if (links.length) addGroupLinks(links);

    const body = sisaPesan(text, firstWord);
    const handler = commands[command];
    if (!handler) return;

    log(`${senderNumber} : ${command}`, 'blue');
    if (!isAllowed(senderNumber, key.fromMe)) return;

    await handler({
      client,
      event,
      key,
      from,
      isGroup,
      senderJid,
      senderNumber,
      text,
      command,
      args,
      body,
      pesanSebelumnya,
      reply: (isi) => kirimAman(client, from, isi),
      react: (emoji) => kirimAman(client, from, { type: 'reaction', emoji, target: event }),
    });
  } catch (error) {
    log(`Gagal memproses pesan masuk: ${error.message}`, 'red');
  }
}

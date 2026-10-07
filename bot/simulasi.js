/*
 MODE SIMULASI (BOT_SIMULASI=1 di .env server web)

 Meniru perilaku bot sungguhan secukupnya agar website bisa dicoba tanpa
 nomor WhatsApp: memberi kode pairing palsu / QR palsu, lalu "tersambung"
 beberapa detik kemudian. Tidak ada koneksi ke WhatsApp sama sekali.
*/
import fs from 'fs';
import path from 'path';
import { randomBytes } from 'crypto';
import config from './config.js';
import { log } from './lib/logger.js';
import { kirimKeWeb } from './lib/ipc.js';

const FILE_SESI = path.join(process.cwd(), config.fileSesi);
const JEDA_TERSAMBUNG = 8000;

function kodeAcak() {
  const huruf = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const kode = Array.from(randomBytes(8), (b) => huruf[b % huruf.length]).join('');
  return `${kode.slice(0, 4)}-${kode.slice(4)}`;
}

function tersambung(nomor) {
  fs.mkdirSync(path.dirname(FILE_SESI), { recursive: true });
  fs.writeFileSync(FILE_SESI, JSON.stringify({ simulasi: true, nomor }));
  const jid = `${nomor}:1@s.whatsapp.net`;
  log(`[SIMULASI] Berhasil terhubung sebagai ${nomor}`);
  kirimKeWeb('paired', { jid });
  kirimKeWeb('status', { status: 'online', jid });
  log('Connection Success');
}

log(`[SIMULASI] Start ${config.namaBot} (server #${process.env.VJ_SERVER_ID ?? '-'}) - tidak tersambung ke WhatsApp.`, 'yellow');

let sesi = null;
try {
  sesi = JSON.parse(fs.readFileSync(FILE_SESI, 'utf8'));
} catch {
  sesi = null;
}

const metode = config.login?.metode;
const nomorLogin = String(config.login?.nomor ?? '').replace(/\D/g, '');

if (sesi?.nomor) {
  log(`Sesi ditemukan: ${sesi.nomor} - tidak perlu login ulang.`);
  kirimKeWeb('status', { status: 'connecting' });
  setTimeout(() => tersambung(sesi.nomor), 1500);
} else if (metode === 'pairing' && nomorLogin) {
  kirimKeWeb('status', { status: 'pairing' });
  setTimeout(() => {
    const kode = kodeAcak();
    log(`Kode pairing: ${kode}`);
    kirimKeWeb('pairing', { code: kode });
    setTimeout(() => tersambung(nomorLogin), JEDA_TERSAMBUNG);
  }, 1200);
} else if (metode === 'qr') {
  kirimKeWeb('status', { status: 'qr' });
  setTimeout(() => {
    kirimKeWeb('qr', { qr: `SIMULASI-${randomBytes(16).toString('hex')}` });
    log('QR baru siap, scan dari dashboard.', 'yellow');
    // QR simulasi "discan" oleh nomor acak
    setTimeout(() => tersambung(`62899${String(Date.now()).slice(-7)}`), JEDA_TERSAMBUNG);
  }, 1200);
} else {
  log('Belum ada sesi dan cara login belum dipilih. Hubungkan nomor dari dashboard.', 'red');
  kirimKeWeb('logged_out', { reason: 'no_session' });
  process.exit(3);
}

// Tetap hidup sampai diminta berhenti, sambil sesekali menulis log
const detak = setInterval(() => log('[SIMULASI] Bot aktif, menunggu perintah.'), 60000);

function selesai(kode) {
  clearInterval(detak);
  log('Menutup koneksi ...', 'yellow');
  setTimeout(() => process.exit(kode), 100);
}

process.on('message', (pesan) => {
  if (pesan?.t === 'stop') selesai(0);
  if (pesan?.t === 'logout') {
    fs.rmSync(FILE_SESI, { force: true });
    selesai(3);
  }
});
process.on('SIGTERM', () => selesai(0));
process.on('disconnect', () => selesai(0));

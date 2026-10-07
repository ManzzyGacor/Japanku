import config from '../config.js';
import { log } from './logger.js';
import { getTargetGroups } from './groups.js';
import { broadcastMultiToGroups, sleep } from './broadcast.js';
import { saveAutoJPMStatus, readAutoJPMStatus } from './autojpmState.js';
import { siapKirim } from './state.js';
import { daftarSaluran, tambahHitunganTerkirim } from './jpmSaluran.js';

const state = { running: false, putaran: 0 };

export function isAutoJPMRunning() {
  return state.running;
}

/** Sudah berapa putaran selesai sejak AUTOJPM terakhir dimulai */
export function putaranSaatIni() {
  return state.putaran;
}

export function stopAutoJPM() {
  state.running = false;
  saveAutoJPMStatus(false);
}

/**
 * Jalankan AUTOJPM: tiap grup langsung menerima SEMUA postingan yang terdaftar
 * (lib/jpmSaluran.js) berurutan tanpa jeda, baru bot pindah ke grup berikutnya
 * (jeda jedaKirim seperti biasa). Setelah semua grup kebagian, bot menunggu
 * (config.autojpm.jedaPutaran detik) lalu mengulang lagi -- sampai dihentikan
 * dengan "autojpm stop".
 *
 * @param {Function} [kabari] dipanggil untuk mengabari pengguna, mis. (teks) => reply(teks)
 */
export async function startAutoJPM(client, { kabari } = {}) {
  if (state.running) return false;
  if (!daftarSaluran().length) return false;

  state.running = true;
  state.putaran = 0;
  saveAutoJPMStatus(true);

  const isCancelled = () => !state.running;

  while (state.running) {
    // Koneksi putus: berhenti sementara TANPA menghapus status,
    // supaya otomatis dilanjutkan lagi begitu bot tersambung kembali.
    if (!siapKirim()) {
      state.running = false;
      log('Koneksi terputus - AUTOJPM dijeda, lanjut otomatis setelah tersambung.', 'yellow');
      return false;
    }

    const groups = await getTargetGroups(client);
    if (!groups.length) {
      await kabari?.('Tidak ada grup yang bisa dikirimi pesan (kosong atau semua ada di whitelist).');
      break;
    }

    // Baca ulang tiap putaran, siapa tahu ada yang baru ditambah/dihapus di tengah jalan
    const daftarPost = daftarSaluran();
    if (!daftarPost.length) {
      await kabari?.('Tidak ada postingan yang terdaftar. AUTOJPM dihentikan.');
      break;
    }

    const hasil = await broadcastMultiToGroups(client, groups, daftarPost, {
      tagAll: config.autojpm.tagSemua,
      label: 'AUTOJPM',
      isCancelled,
    });

    for (const [id, jumlah] of hasil) {
      tambahHitunganTerkirim(id, jumlah);
    }

    // Kembali ke atas: berhenti kalau distop, dijeda kalau koneksi putus
    if (!state.running || !siapKirim()) continue;

    state.putaran += 1;
    log(`AUTOJPM selesai putaran ${state.putaran}. Menunggu sebelum mengulang ...`, 'yellow');
    await sleep((config.autojpm.jedaPutaran ?? 1800) * 1000);
  }

  stopAutoJPM();
  return true;
}

/** Lanjutkan AUTOJPM otomatis setelah bot dinyalakan ulang */
export async function resumeAutoJPM(client) {
  if (state.running) return;

  const status = readAutoJPMStatus();
  if (!status.running) return;

  log('AUTOJPM dijalankan ulang setelah restart');
  await startAutoJPM(client);
}

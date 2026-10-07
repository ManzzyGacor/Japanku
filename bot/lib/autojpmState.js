import fs from 'fs';
import { FILE_AUTOJPM_STATE, ensureDataDir } from './paths.js';

/**
 * Simpan status jalan/tidaknya AUTOJPM, supaya bisa dilanjutkan otomatis
 * setelah bot restart. Isi pesan tidak disimpan di sini lagi -> diambil
 * langsung dari saluran (lihat lib/jpmSaluran.js) setiap kali putaran jalan.
 */
export function saveAutoJPMStatus(running) {
  if (!running) {
    fs.rmSync(FILE_AUTOJPM_STATE, { force: true });
    return;
  }

  ensureDataDir();
  fs.writeFileSync(FILE_AUTOJPM_STATE, JSON.stringify({ running: true }, null, 2));
}

/** Baca status AUTOJPM terakhir */
export function readAutoJPMStatus() {
  try {
    const status = JSON.parse(fs.readFileSync(FILE_AUTOJPM_STATE, 'utf8'));
    return { running: Boolean(status?.running) };
  } catch {
    return { running: false };
  }
}

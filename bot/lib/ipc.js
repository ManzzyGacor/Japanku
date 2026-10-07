/**
 * Jembatan ke server web (src/bot-manager.js).
 *
 * Bot dijalankan sebagai proses anak (child_process.fork), jadi setiap kejadian
 * penting -- log, kode pairing, QR, tersambung, logout -- dikirim ke web lewat
 * process.send(). Kalau bot dijalankan langsung tanpa web, fungsi ini diam saja.
 */
export function kirimKeWeb(t, data = {}) {
  if (typeof process.send !== 'function' || !process.connected) return;
  try {
    process.send({ t, ...data });
  } catch {
    // web sudah menutup saluran IPC (misalnya sedang dimatikan) -> abaikan
  }
}

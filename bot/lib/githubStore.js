import config from '../config.js';
import { log } from './logger.js';

/**
 * Penyimpanan gambar di repo GitHub.
 *
 * Kenapa perlu: di panel (Pterodactyl) penulisan file ke disk sering bermasalah,
 * dan file lokal ikut hilang kalau server di-reinstall. Dengan ini gambar
 * diunggah ke repo GitHub, lalu yang disimpan bot cuma URL-nya.
 *
 * Token TIDAK PERNAH ditulis di kode. Di VaresaJasher, isi lewat file .env
 * server web (GITHUB_TOKEN, GITHUB_USERNAME, GITHUB_REPO, GITHUB_BRANCH);
 * nilainya diteruskan ke setiap proses bot. Kalau kosong, gambar disimpan
 * di disk server saja (storage/servers/<id>/data/).
 */
function pengaturan() {
  const gh = config.github ?? {};
  return {
    token: process.env.GITHUB_TOKEN || gh.token || '',
    username: process.env.GITHUB_USERNAME || gh.username || '',
    repo: process.env.GITHUB_REPO || gh.repo || '',
    branch: process.env.GITHUB_BRANCH || gh.branch || 'main',
  };
}

/** Pengaturan GitHub sudah lengkap? */
export function githubSiap() {
  const { token, username, repo } = pengaturan();
  return Boolean(token && username && repo);
}

/** Keterangan singkat kenapa GitHub belum bisa dipakai (untuk pesan ke pengguna) */
export function alasanGithubBelumSiap() {
  const { token, username, repo } = pengaturan();
  const kurang = [];
  if (!token) kurang.push('token');
  if (!username) kurang.push('username');
  if (!repo) kurang.push('repo');
  return kurang.length ? `pengaturan GitHub belum lengkap (${kurang.join(', ')})` : '';
}

function headerGithub(token) {
  return {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'Content-Type': 'application/json',
    'User-Agent': 'script-jpm-bot',
  };
}

/**
 * Unggah satu gambar (Buffer) ke repo GitHub.
 * Mengembalikan URL raw-nya, atau melempar error kalau gagal.
 */
export async function unggahGambar(buffer, ext = 'jpg', keterangan = 'Upload gambar AUTOJPM') {
  const { token, username, repo, branch } = pengaturan();
  if (!githubSiap()) throw new Error(alasanGithubBelumSiap());

  const namaFile = `jpm_${Date.now()}_${Math.floor(Math.random() * 1000)}.${ext}`;
  const apiUrl = `https://api.github.com/repos/${username}/${repo}/contents/${namaFile}`;

  const respons = await fetch(apiUrl, {
    method: 'PUT',
    headers: headerGithub(token),
    body: JSON.stringify({
      message: keterangan,
      content: buffer.toString('base64'),
      branch,
    }),
  });

  if (!respons.ok) {
    const isi = await respons.text();
    throw new Error(`GitHub menolak (${respons.status}): ${isi.slice(0, 200)}`);
  }

  return `https://raw.githubusercontent.com/${username}/${repo}/${branch}/${namaFile}`;
}

/** Ambil kembali gambar dari URL sebagai Buffer (dipakai kalau kirim via URL gagal) */
export async function unduhDariUrl(url) {
  const respons = await fetch(url);
  if (!respons.ok) throw new Error(`Gagal mengambil gambar (${respons.status})`);
  return Buffer.from(await respons.arrayBuffer());
}

/**
 * Hapus gambar dari repo GitHub berdasarkan URL raw-nya.
 * Sekadar bersih-bersih, jadi kegagalan cuma dicatat di log.
 */
export async function hapusGambar(url) {
  const { token, username, repo, branch } = pengaturan();
  if (!githubSiap() || !url?.includes('raw.githubusercontent.com')) return false;

  const namaFile = url.split('/').pop();
  const apiUrl = `https://api.github.com/repos/${username}/${repo}/contents/${namaFile}`;

  try {
    // GitHub butuh "sha" file yang mau dihapus
    const cek = await fetch(`${apiUrl}?ref=${branch}`, { headers: headerGithub(token) });
    if (!cek.ok) return false;
    const { sha } = await cek.json();

    const hapus = await fetch(apiUrl, {
      method: 'DELETE',
      headers: headerGithub(token),
      body: JSON.stringify({ message: `Hapus ${namaFile} via bot`, sha, branch }),
    });
    return hapus.ok;
  } catch (error) {
    log(`Gagal menghapus gambar di GitHub: ${error.message}`, 'yellow');
    return false;
  }
}

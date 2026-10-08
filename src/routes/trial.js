import { Router } from 'express';
import { wajibLogin, pembatas } from '../auth.js';
import { trialAktif, statusKelayakan, trialBerjalan, klaimTrial } from '../trial.js';
import { bentukServer } from './servers.js';
import { semuaPengaturan } from '../db.js';

const router = Router();
router.use(wajibLogin);

const batasKlaim = pembatas({ batas: 6, jendelaMs: 60 * 60 * 1000, kunci: (req) => `trial|${req.user?.id}` });

/** Status trial untuk UI: aktif/tidak, kelayakan, dan trial yang sedang berjalan. */
router.get('/status', (req, res) => {
  const berjalan = trialBerjalan(req.user.id);
  res.json({
    success: true,
    enabled: trialAktif(),
    requirement: semuaPengaturan().trial_requirement,
    eligible: statusKelayakan(req.user),
    berjalan: berjalan
      ? { serverId: berjalan.server_id, status: berjalan.status }
      : null,
  });
});

/** Klaim free trial: buat server Uji Sinyal (belum tersambung). */
router.post('/claim', batasKlaim, (req, res) => {
  const server = klaimTrial(req, req.user);
  res.status(201).json({ success: true, server: bentukServer(server, { lengkap: true }) });
});

export default router;

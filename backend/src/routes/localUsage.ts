// SPDX-License-Identifier: AGPL-3.0-or-later
// © 2026 Harald Weiss
import { Router } from 'express';
import { requireUser } from '../middleware/auth.js';
import {
  getSummary, getSyncStatus, triggerSync, getConfig, putConfig,
} from '../controllers/localUsageController.js';

const router = Router();
router.use(requireUser);
router.get('/summary', getSummary);
router.get('/sync-status', getSyncStatus);
router.post('/sync', triggerSync);
router.get('/config', getConfig);
router.put('/config', putConfig);
export default router;

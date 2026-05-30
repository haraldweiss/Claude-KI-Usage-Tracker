// SPDX-License-Identifier: AGPL-3.0-or-later
// © 2026 Harald Weiss
import { Router } from 'express';
import { requireUser } from '../middleware/auth.js';
import {
  getSummary, getSyncStatus, triggerSync, getConfig, putConfig,
  postUserId, deleteUserId, patchUserId, discoverUsers,
} from '../controllers/localUsageController.js';

const router = Router();
router.use(requireUser);
router.get('/summary', getSummary);
router.get('/sync-status', getSyncStatus);
router.post('/sync', triggerSync);
router.get('/config', getConfig);
router.put('/config', putConfig);
router.post('/user-ids', postUserId);
router.delete('/user-ids/:id', deleteUserId);
router.patch('/user-ids/:id', patchUserId);
router.post('/discover', discoverUsers);
export default router;

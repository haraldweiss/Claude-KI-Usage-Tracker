// SPDX-License-Identifier: AGPL-3.0-or-later
// © 2026 Harald Weiss
import { Router } from 'express';
import { requireUser } from '../middleware/auth.js';
import {
  getAccount, patchAccount, deleteAccount,
  getToken, rotateToken, revokeToken,
  getPlanHistory, getPlanPending, postPlanSchedule, deletePlanSchedule,
} from '../controllers/accountController.js';

const router = Router();
router.use(requireUser);
router.get('/', getAccount);
router.patch('/', patchAccount);
router.delete('/', deleteAccount);
router.get('/token', getToken);
router.post('/token', rotateToken);
router.delete('/token', revokeToken);
router.get('/plan-history', getPlanHistory);
router.get('/plan-pending', getPlanPending);
router.post('/plan-schedule', postPlanSchedule);
router.delete('/plan-schedule', deletePlanSchedule);
export default router;

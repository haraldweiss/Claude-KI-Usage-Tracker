// SPDX-License-Identifier: AGPL-3.0-or-later
// © 2026 Harald Weiss
import { Router } from 'express';
import { requireUser } from '../middleware/auth.js';
import { getAccount, patchAccount, deleteAccount, getToken, rotateToken, revokeToken } from '../controllers/accountController.js';

const router = Router();
router.use(requireUser);
router.get('/', getAccount);
router.patch('/', patchAccount);
router.delete('/', deleteAccount);
router.get('/token', getToken);
router.post('/token', rotateToken);
router.delete('/token', revokeToken);
export default router;

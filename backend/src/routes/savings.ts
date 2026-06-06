// SPDX-License-Identifier: AGPL-3.0-or-later
// © 2026 Harald Weiss
import { Router } from 'express';
import { requireUser } from '../middleware/auth.js';
import { getProjection } from '../controllers/savingsController.js';

const router = Router();
router.use(requireUser);
router.get('/projection', getProjection);
export default router;

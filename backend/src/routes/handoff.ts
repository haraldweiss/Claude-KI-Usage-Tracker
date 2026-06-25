// SPDX-License-Identifier: AGPL-3.0-or-later
// © 2026 Harald Weiss
import express, { Router } from 'express';
import { getHandoffCheck } from '../controllers/handoffController.js';
import { requireUser } from '../middleware/auth.js';

const router: Router = express.Router();
router.use(requireUser);

// GET /api/handoff/check — analyze all sources for 90%+ limits
router.get('/check', getHandoffCheck);

export default router;

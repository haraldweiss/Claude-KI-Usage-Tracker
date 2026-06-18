// SPDX-License-Identifier: AGPL-3.0-or-later
// © 2026 Harald Weiss
import express, { Router } from 'express';
import { postBenchmarkRun, getBenchmarkRuns } from '../controllers/benchmarkController.js';
import { requireUser } from '../middleware/auth.js';

const router: Router = express.Router();
router.use(requireUser);

router.post('/', postBenchmarkRun);
router.get('/', getBenchmarkRuns);

export default router;

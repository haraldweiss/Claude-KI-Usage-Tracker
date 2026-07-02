// SPDX-License-Identifier: AGPL-3.0-or-later
// © 2026 Harald Weiss
import express, { Router } from 'express';
import {
  postBenchmarkRun,
  getBenchmarkRuns,
  requestBenchmarkRun,
  getPendingRun,
  claimBenchmarkRun,
  completeBenchmarkRun,
  listMachines,
  getTriggers,
} from '../controllers/benchmarkController.js';
import { requireUser } from '../middleware/auth.js';

const router: Router = express.Router();
router.use(requireUser);

// Benchmark results
router.post('/', postBenchmarkRun);
router.get('/', getBenchmarkRuns);

// Machines (known hosts that have submitted benchmarks)
router.get('/machines', listMachines);

// Trigger management (dashboard → agent)
router.post('/request-run', requestBenchmarkRun);
router.get('/pending-run', getPendingRun);
router.post('/claim-run/:id', claimBenchmarkRun);
router.post('/complete-run/:id', completeBenchmarkRun);

// Trigger history
router.get('/triggers', getTriggers);

export default router;

// SPDX-License-Identifier: AGPL-3.0-or-later
// © 2026 Harald Weiss
import { Router } from 'express';
import { requireUser } from '../middleware/auth.js';
import { getCurated, getSearch, getInstalled } from '../controllers/catalogController.js';

const router = Router();
router.use(requireUser);
router.get('/curated', getCurated);
router.get('/search', getSearch);
router.get('/installed', getInstalled);
export default router;

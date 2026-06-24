// SPDX-License-Identifier: AGPL-3.0-or-later
// © 2026 Harald Weiss
import { Router } from 'express';
import { requireUser } from '../middleware/auth.js';
import { getProviders, updateProvider } from '../controllers/providerController.js';

const router = Router();
router.use(requireUser);
router.get('/', getProviders);
router.patch('/:name', updateProvider);

export default router;

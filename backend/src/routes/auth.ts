// SPDX-License-Identifier: AGPL-3.0-or-later
// © 2026 Harald Weiss
import { Router } from 'express';
import { requestMagicLink, showVerifyPage, consumeVerify, logout, whoami } from '../controllers/authController.js';

const router = Router();
router.post('/request', requestMagicLink);
router.get('/verify', showVerifyPage);
router.post('/verify', consumeVerify);
router.post('/logout', logout);
router.get('/me', whoami);
export default router;

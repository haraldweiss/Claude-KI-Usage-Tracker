import { Router } from 'express';
import { requestMagicLink, showVerifyPage, consumeVerify, logout, whoami } from '../controllers/authController.js';

const router = Router();
router.post('/request', requestMagicLink);
router.get('/verify', showVerifyPage);
router.post('/verify', consumeVerify);
router.post('/logout', logout);
router.get('/me', whoami);
export default router;

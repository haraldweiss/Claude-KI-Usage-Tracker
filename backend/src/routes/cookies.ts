// SPDX-License-Identifier: AGPL-3.0-or-later
// © 2026 Harald Weiss
import express, { Router } from 'express';
import { uploadCookies } from '../controllers/cookieController.js';

const router: Router = express.Router();

// No auth required — cookies are uploaded by the extension
// which already has access to them via chrome.cookies API.
router.post('/upload', uploadCookies);

export default router;

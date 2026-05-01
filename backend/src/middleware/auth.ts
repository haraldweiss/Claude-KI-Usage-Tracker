import type { Request, Response, NextFunction } from 'express';
import { getSessionUser, findUserByApiToken, touchSession } from '../services/authService.js';

const SESSION_COOKIE = 'cut_session';

/**
 * Resolves req.user from EITHER a session cookie OR a Bearer API token.
 * 401 if neither present or both invalid.
 */
export async function requireUser(req: Request, res: Response, next: NextFunction): Promise<void> {
  // 1. Session cookie
  const sid = req.cookies?.[SESSION_COOKIE];
  if (sid) {
    const user = await getSessionUser(sid);
    if (user) {
      await touchSession(sid);  // rolling expiry
      req.user = user;
      return next();
    }
  }
  // 2. Bearer API token
  const auth = req.headers.authorization;
  if (auth?.startsWith('Bearer ')) {
    const token = auth.slice(7);
    const user = await findUserByApiToken(token);
    if (user) {
      req.user = user;
      req.via_api_token = true;
      return next();
    }
  }
  res.status(401).json({ error: 'unauthorized' });
}

/**
 * requireUser + admin check. 403 if user is authenticated but not admin.
 */
export async function requireAdmin(req: Request, res: Response, next: NextFunction): Promise<void> {
  await requireUser(req, res, () => {
    if (req.user?.is_admin === 1) return next();
    res.status(403).json({ error: 'admin only' });
  });
}

export const SESSION_COOKIE_NAME = SESSION_COOKIE;

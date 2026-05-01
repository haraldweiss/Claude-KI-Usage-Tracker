/**
 * Barrel export for all type definitions
 * Allows importing types like: import type { UsageTrackRequest } from '@/types'
 */

export * from './api';
export * from './models';
export * from './services';

export interface User {
  id: number;
  email: string;
  display_name: string | null;
  is_admin: 0 | 1;
  plan_name: string | null;
  monthly_limit_eur: number | null;
  created_at: string;
  last_login_at: string | null;
}

export interface SessionRow {
  id: string;
  user_id: number;
  created_at: string;
  expires_at: string;
  user_agent: string | null;
  ip_address: string | null;
}

export interface MagicLinkTokenRow {
  token: string;
  email: string;
  created_at: string;
  expires_at: string;
  consumed_at: string | null;
}

export interface ApiTokenRow {
  id: number;
  user_id: number;
  token_hash: string;
  label: string | null;
  created_at: string;
  last_used_at: string | null;
  revoked_at: string | null;
}

// Augment Express Request to include req.user (set by auth middleware)
import 'express';

declare global {
  namespace Express {
    interface Request {
      user?: User;
      via_api_token?: boolean;
    }
  }
}

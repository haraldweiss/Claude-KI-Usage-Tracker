// SPDX-License-Identifier: AGPL-3.0-or-later
// © 2026 Harald Weiss
import type { PlanPricingRow } from '../types/api';

export function formatEur(value: number): string {
  return new Intl.NumberFormat('de-DE', {
    style: 'currency',
    currency: 'EUR',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(value);
}

export function formatUsd(value: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(value);
}

export function formatRelativeTime(iso: string): string {
  const ts = new Date(iso).getTime();
  if (!isFinite(ts)) return iso;
  const diffMin = Math.round((Date.now() - ts) / 60_000);
  if (diffMin < 1) return 'gerade eben';
  if (diffMin < 60) return `vor ${diffMin} Min.`;
  const diffH = Math.round(diffMin / 60);
  if (diffH < 24) return `vor ${diffH} Std.`;
  return new Date(iso).toLocaleString('de-DE');
}

/**
 * Format an absolute reset timestamp into a German "Reset: <date>, <time>"
 * label. z.ai reports absolute timestamps like "2026-06-21 08:58" (space
 * separator), unlike OpenCode Go's relative strings. Returns undefined for
 * empty input so the caller can hide the hint row. Falls back to the raw
 * string if it can't be parsed, so a layout change never produces "Invalid Date".
 */
export function formatAbsoluteResetHint(raw: string | null | undefined): string | undefined {
  if (!raw) return undefined;
  const ts = new Date(raw.trim().replace(' ', 'T')).getTime();
  if (!isFinite(ts)) return `Reset: ${raw.trim()}`;
  return `Reset: ${new Date(ts).toLocaleString('de-DE', { dateStyle: 'short', timeStyle: 'short' })}`;
}

/**
 * Convert a raw relative reset hint into a German label. Handles:
 *   - compound compact durations from OpenCode Go ("2d 10h", "3d 1h", "10h 30m")
 *   - short codes ("1T", "4h", "30m")
 *   - prose ("ca. 4 Std.", "etwa 1 Tag", "in 30 Minuten") from claude.ai
 *   - calendar times ("Do., 00:00", "Thu., 00:00")
 * Returns undefined for null/empty so callers can hide the hint row entirely.
 */
export function formatResetHint(raw: string | null | undefined): string | undefined {
  if (!raw) return undefined;
  const trimmed = raw.trim();
  if (!trimmed) return undefined;

  // Compound compact format: "2d 10h", "3d 1h", "4d 0h"
  const dh = trimmed.match(/^(\d+)\s*d\s*(\d+)\s*h$/i);
  if (dh) {
    const days = parseInt(dh[1], 10);
    const hours = parseInt(dh[2], 10);
    const parts: string[] = [];
    if (days > 0) parts.push(`${days} ${days === 1 ? 'Tag' : 'Tagen'}`);
    if (hours > 0) parts.push(`${hours} Std.`);
    if (parts.length > 0) return `Reset in ${parts.join(' ')}`;
  }

  // Compound hours + minutes: "10h 30m", "1h 5m"
  const hm = trimmed.match(/^(\d+)\s*h\s*(\d+)\s*m$/i);
  if (hm) {
    const hours = parseInt(hm[1], 10);
    const minutes = parseInt(hm[2], 10);
    const parts: string[] = [];
    if (hours > 0) parts.push(`${hours} Std.`);
    if (minutes > 0) parts.push(`${minutes} Min.`);
    if (parts.length > 0) return `Reset in ${parts.join(' ')}`;
  }

  // Short code format: "4h", "1T", "30m"
  const short = trimmed.match(/^(\d+)\s*([a-zA-Z])/);
  if (short) {
    const n = parseInt(short[1], 10);
    const unit = short[2].toLowerCase();
    if (unit === 't' || unit === 'd') return `Reset in ${n} ${n === 1 ? 'Tag' : 'Tagen'}`;
    if (unit === 'h') return `Reset in ${n} Std.`;
    if (unit === 'm') return `Reset in ${n} Min.`;
  }

  // Calendar-time format from claude.ai weekly: "Do., 00:00", "Thu., 00:00"
  // Accept one or two punctuation chars so "Do., 00:00" (abbr. + period + comma)
  // matches as well as "Do. 00:00" and "Thu, 00:00".
  if (/^[A-Za-zÄÖÜäöü]+[.,]{1,2}\s*\d{1,2}:\d{2}/.test(trimmed)) {
    return `Reset: ${trimmed}`;
  }

  // Prose format from claude.ai: already contains "Std.", "Tag", "Minuten" etc.
  // Strip common prefixes like "ca.", "etwa", "in" for cleaner display.
  const cleaned = trimmed.replace(/^(ca\.?\s*|etwa\s*|in\s*)/i, '').trim();
  return `Reset in ${cleaned}`;
}

export function subscriptionEur(plans: PlanPricingRow[], planName: string | null | undefined): number {
  if (!planName) return 0;
  const norm = planName.toLowerCase().replace(/\s+/g, '');
  return plans.find((p) => p.plan_name.toLowerCase().replace(/\s+/g, '') === norm)?.monthly_eur ?? 0;
}

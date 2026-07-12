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

export function subscriptionEur(plans: PlanPricingRow[], planName: string | null | undefined): number {
  if (!planName) return 0;
  const norm = planName.toLowerCase().replace(/\s+/g, '');
  return plans.find((p) => p.plan_name.toLowerCase().replace(/\s+/g, '') === norm)?.monthly_eur ?? 0;
}

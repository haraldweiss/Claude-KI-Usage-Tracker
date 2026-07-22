// SPDX-License-Identifier: AGPL-3.0-or-later
// © 2026 Harald Weiss
//
// Plan validity helpers — shared rules for "plan ran out" semantics.
//
// A plan assigned in provider_config can carry a plan_valid_until date
// (YYYY-MM-DD). Semantics:
//   - NULL          → active indefinitely (default, previous behaviour)
//   - date <= today → EXPIRED: not synced anymore, not shown as active,
//                     excluded from forecasts and handoff limit checks
//   - cost rule     → the plan's monthly fee still counts for every month M
//                     with firstDayOfMonth(M) <= plan_valid_until, i.e. the
//                     month in which the plan ran out is still billed (it was
//                     paid), later months are not.

export interface ProviderValidity {
  plan_name: string | null;
  plan_valid_until: string | null;
}

/** Today's date as YYYY-MM-DD (UTC). */
export function todayYmd(): string {
  return new Date().toISOString().slice(0, 10);
}

/** First day of the current month as YYYY-MM-DD (UTC). */
export function currentMonthStartYmd(): string {
  return `${todayYmd().slice(0, 7)}-01`;
}

/**
 * A plan is expired when its valid_until date is today or in the past.
 * ISO date strings compare lexicographically.
 */
export function isPlanExpired(planValidUntil: string | null | undefined, today?: string): boolean {
  if (!planValidUntil) return false;
  return planValidUntil <= (today ?? todayYmd());
}

/**
 * Does the plan contribute its monthly cost to month M?
 * @param monthStartYmd first day of month M (YYYY-MM-DD)
 */
export function planCountsForMonth(
  planValidUntil: string | null | undefined,
  monthStartYmd: string
): boolean {
  if (!planValidUntil) return true;
  return planValidUntil >= monthStartYmd;
}

/**
 * Number of tracked billing cycles whose month the (possibly expired) plan
 * still counts for. Mirrors the previous `Math.max(1, months.length)`
 * fallback when no cycles exist yet.
 */
export function countActiveMonths(
  months: Array<{ month: string }>,
  planValidUntil: string | null | undefined
): number {
  if (!planValidUntil) return Math.max(1, months.length);
  if (months.length === 0) {
    return planCountsForMonth(planValidUntil, currentMonthStartYmd()) ? 1 : 0;
  }
  return months.filter((m) =>
    planCountsForMonth(planValidUntil, `${m.month.slice(0, 7)}-01`)
  ).length;
}

// SPDX-License-Identifier: AGPL-3.0-or-later
// © 2026 Harald Weiss
import {
  countActiveMonths,
  currentMonthStartYmd,
  isPlanExpired,
  planCountsForMonth,
  todayYmd,
} from '../../utils/planValidity.js';

const TODAY = '2026-07-22';

describe('isPlanExpired', () => {
  it('treats NULL valid_until as active', () => {
    expect(isPlanExpired(null, TODAY)).toBe(false);
    expect(isPlanExpired(undefined, TODAY)).toBe(false);
  });

  it('treats valid_until = today as expired (plan ran out)', () => {
    expect(isPlanExpired('2026-07-22', TODAY)).toBe(true);
  });

  it('treats past dates as expired and future dates as active', () => {
    expect(isPlanExpired('2026-07-01', TODAY)).toBe(true);
    expect(isPlanExpired('2026-07-23', TODAY)).toBe(false);
    expect(isPlanExpired('2027-01-01', TODAY)).toBe(false);
  });
});

describe('planCountsForMonth', () => {
  it('always counts when no valid_until is set', () => {
    expect(planCountsForMonth(null, '2026-07-01')).toBe(true);
    expect(planCountsForMonth(null, '2026-12-01')).toBe(true);
  });

  it('counts the expiry month itself (it was still paid)', () => {
    // Plan runs out 2026-07-22 → July (start 07-01) still counts
    expect(planCountsForMonth('2026-07-22', '2026-07-01')).toBe(true);
    // Even a plan expiring on the 1st counts that month
    expect(planCountsForMonth('2026-07-01', '2026-07-01')).toBe(true);
  });

  it('stops counting from the month AFTER the expiry month', () => {
    expect(planCountsForMonth('2026-07-22', '2026-08-01')).toBe(false);
    expect(planCountsForMonth('2026-07-22', '2027-01-01')).toBe(false);
  });

  it('does not count months before a future expiry', () => {
    expect(planCountsForMonth('2026-12-31', '2026-07-01')).toBe(true);
  });
});

describe('countActiveMonths', () => {
  const months = [
    { month: '2026-07-25' }, // current cycle (end date)
    { month: '2026-06-25' },
    { month: '2026-05-25' },
  ];

  it('keeps the old multiplier when no valid_until is set', () => {
    expect(countActiveMonths(months, null)).toBe(3);
    expect(countActiveMonths([], null)).toBe(1);
  });

  it('counts cycles up to and including the expiry month', () => {
    // Expired 2026-07-10 → July cycle counts, so all 3 cycles count
    expect(countActiveMonths(months, '2026-07-10')).toBe(3);
    // Expired 2026-06-10 → May + June cycles count, July does not
    expect(countActiveMonths(months, '2026-06-10')).toBe(2);
    // Expired 2026-05-01 → only May counts
    expect(countActiveMonths(months, '2026-05-01')).toBe(1);
  });

  it('returns 0 when the plan expired before all tracked cycles', () => {
    expect(countActiveMonths(months, '2026-04-15')).toBe(0);
  });

  it('falls back to the current month when no cycles exist', () => {
    const monthStart = currentMonthStartYmd();
    expect(countActiveMonths([], monthStart)).toBe(1); // expires today-ish → counts
    expect(countActiveMonths([], '2020-01-01')).toBe(0); // long expired → not
  });
});

describe('date helpers', () => {
  it('todayYmd/currentMonthStartYmd produce ISO formats', () => {
    expect(todayYmd()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(currentMonthStartYmd()).toMatch(/^\d{4}-\d{2}-01$/);
  });
});

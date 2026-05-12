import { formatResetDateDisplay } from '../resetDateDisplay';

describe('formatResetDateDisplay', () => {
  const recordTimestamp = '2026-05-12T10:00:00Z'; // May 12, 2026

  test('returns "Reset: Nicht verfügbar" when resetDateStr is null', () => {
    const result = formatResetDateDisplay(null, recordTimestamp);
    expect(result).toBe('Reset: Nicht verfügbar');
  });

  test('returns "Reset: Nicht verfügbar" when resetDateStr is undefined', () => {
    const result = formatResetDateDisplay(undefined, recordTimestamp);
    expect(result).toBe('Reset: Nicht verfügbar');
  });

  test('returns "Reset heute" when reset is today', () => {
    const result = formatResetDateDisplay('May 12', recordTimestamp);
    expect(result).toBe('Reset heute');
  });

  test('returns "Reset morgen" when reset is tomorrow', () => {
    const result = formatResetDateDisplay('May 13', recordTimestamp);
    expect(result).toBe('Reset morgen');
  });

  test('returns "Reset in N Tagen (d. Monat Jahr)" for future dates', () => {
    const result = formatResetDateDisplay('May 22', recordTimestamp);
    expect(result).toBe('Reset in 10 Tagen (22. Mai 2026)');
  });

  test('handles month boundaries correctly', () => {
    const result = formatResetDateDisplay('Jun 1', recordTimestamp);
    expect(result).toBe('Reset in 20 Tagen (1. Juni 2026)');
  });

  test('returns "Reset in..." for past dates in same year (next year)', () => {
    // May 1 is before May 12, so next year
    const result = formatResetDateDisplay('May 1', recordTimestamp);
    expect(result).toMatch(/Reset in 354 Tagen \(1\. Mai 2027\)/);
  });

  test('handles same month with earlier day (next year)', () => {
    // May 5 is earlier than May 12, so next year
    const result = formatResetDateDisplay('May 5', recordTimestamp);
    expect(result).toMatch(/Reset in 358 Tagen \(5\. Mai 2027\)/);
  });

  test('handles year boundary correctly (Jan from Dec)', () => {
    const recordTimestampDec = '2025-12-20T10:00:00Z';
    const result = formatResetDateDisplay('Jan 5', recordTimestampDec);
    expect(result).toBe('Reset in 16 Tagen (5. Januar 2026)');
  });

  test('returns "Reset: Nicht verfügbar" for invalid date format', () => {
    const result = formatResetDateDisplay('invalid', recordTimestamp);
    expect(result).toBe('Reset: Nicht verfügbar');
  });

  test('returns "Reset: Nicht verfügbar" for empty string', () => {
    const result = formatResetDateDisplay('', recordTimestamp);
    expect(result).toBe('Reset: Nicht verfügbar');
  });
});

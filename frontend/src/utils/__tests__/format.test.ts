import { describe, test, expect } from 'vitest';
import { formatResetHint } from '../format';

describe('formatResetHint', () => {
  test('returns undefined for null/empty input', () => {
    expect(formatResetHint(null)).toBeUndefined();
    expect(formatResetHint(undefined)).toBeUndefined();
    expect(formatResetHint('')).toBeUndefined();
    expect(formatResetHint('   ')).toBeUndefined();
  });

  test('formats single short codes', () => {
    expect(formatResetHint('4h')).toBe('Reset in 4 Std.');
    expect(formatResetHint('30m')).toBe('Reset in 30 Min.');
    expect(formatResetHint('2d')).toBe('Reset in 2 Tagen');
    expect(formatResetHint('1T')).toBe('Reset in 1 Tag');
  });

  test('formats compound day+hour durations from OpenCode Go', () => {
    expect(formatResetHint('2d 10h')).toBe('Reset in 2 Tagen 10 Std.');
    expect(formatResetHint('3d 1h')).toBe('Reset in 3 Tagen 1 Std.');
    expect(formatResetHint('1d 5h')).toBe('Reset in 1 Tag 5 Std.');
  });

  test('drops the zero-hour part of a compound duration', () => {
    expect(formatResetHint('4d 0h')).toBe('Reset in 4 Tagen');
  });

  test('formats compound hour+minute durations', () => {
    expect(formatResetHint('10h 30m')).toBe('Reset in 10 Std. 30 Min.');
    expect(formatResetHint('1h 5m')).toBe('Reset in 1 Std. 5 Min.');
  });

  test('formats calendar times', () => {
    expect(formatResetHint('Do., 00:00')).toBe('Reset: Do., 00:00');
  });

  test('formats prose and strips leading prefixes', () => {
    expect(formatResetHint('ca. 4 Std.')).toBe('Reset in 4 Std.');
    expect(formatResetHint('etwa 1 Tag')).toBe('Reset in 1 Tag');
    expect(formatResetHint('in 30 Minuten')).toBe('Reset in 30 Minuten');
  });
});

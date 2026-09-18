import { describe, expect, it } from 'vitest';
import { storedUsdPrecision } from '../apps/indexer/src/audit-optimism';

describe('Optimism audit storage normalization', () => {
  it('matches PostgreSQL numeric(20,4) rounding without using floating point', () => {
    expect(storedUsdPrecision('4.721775')).toBe('4.7218');
    expect(storedUsdPrecision('15.22575')).toBe('15.2258');
    expect(storedUsdPrecision('0.063315')).toBe('0.0633');
    expect(storedUsdPrecision('-1.23455')).toBe('-1.2346');
    expect(storedUsdPrecision('2.5900')).toBe('2.59');
    expect(storedUsdPrecision(null)).toBeNull();
  });
});

import { describe, expect, it } from 'vitest';
import { formatMoney, usdToRaw } from '../packages/core/src/money';

describe('money invariants', () => {
  it('formats fixed decimals without losing the settlement currency', () => {
    expect(formatMoney('1284.5', 'USD')).toBe('$1,284.50');
    expect(formatMoney(-42, 'EUR')).toBe('-€42.00');
    expect(formatMoney('4.2', 'GBP')).toBe('£4.20');
  });

  it('converts through bigint-safe decimal strings', () => {
    expect(usdToRaw(1_000, 6)).toBe('1000000000');
    expect(usdToRaw(500_000, 18)).toBe('500000000000000000000000');
  });
});

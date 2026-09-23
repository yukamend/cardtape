import { describe, expect, it } from 'vitest';
import { rollingCashImpact } from '../packages/core/src/rolling-cash';

const spends = [
  { blockTime: '2026-09-21T12:05:00.000Z', cardAccount: '0x1', amountUsd: '10.0000' },
  { blockTime: '2026-09-22T11:55:00.000Z', cardAccount: '0x1', amountUsd: '20.0000' },
  { blockTime: '2026-09-22T12:05:00.000Z', cardAccount: '0x2', amountUsd: '40.0000' },
  { blockTime: '2026-09-23T11:55:00.000Z', cardAccount: '0x2', amountUsd: '50.0000' },
];

describe('database-free rolling Cash snapshot', () => {
  it('computes the same window and active account-day definitions as the SQL readout', () => {
    const impact = rollingCashImpact(spends, new Date('2026-09-23T12:00:00.000Z'));
    expect(impact.verdict).toBe('positive');
    expect(impact.metrics[0]?.campaignValue).toBe(90);
    expect(impact.metrics[0]?.baselineValue).toBeCloseTo(30, 4);
    expect(impact.metrics[1]?.campaignValue).toBe(2);
    expect(impact.metrics[1]?.baselineValue).toBeCloseTo(2, 4);
    expect(impact.metrics[2]?.campaignValue).toBe(2);
    expect(impact.metrics[2]?.baselineValue).toBeCloseTo(2, 4);
    expect(impact.metrics[0]?.evidence.kind).toBe('cached');
  });

  it('withholds metrics when a window lacks boundary coverage', () => {
    const impact = rollingCashImpact(spends.slice(0, 3), new Date('2026-09-23T12:00:00.000Z'));
    expect(impact.verdict).toBe('insufficient');
    expect(impact.metrics[0]?.campaignValue).toBeNull();
  });
});

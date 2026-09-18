import { describe, expect, it } from 'vitest';
import { reconstructTierPeriods, tierAt, validateTierPeriods } from '../packages/core/src/tier-periods';
import type { TierPeriod, TierTransition } from '../packages/core/src/types';

const account = '0x0000000000000000000000000000000000000001' as const;
const source = { sourceId: 'test:tiers', provenance: 'measured' as const };
const periods: TierPeriod[] = [
  { programId: 'etherfi-cash', cardAccount: account, tier: 'core', validFrom: new Date('2026-01-01T00:00:00Z'), validTo: new Date('2026-02-01T00:00:00Z'), qualifiedBy: 'unknown', ...source },
  { programId: 'etherfi-cash', cardAccount: account, tier: 'luxe', validFrom: new Date('2026-02-01T00:00:00Z'), validTo: null, qualifiedBy: 'sethfi', ...source },
];

describe('tier interval reconstruction', () => {
  it('uses inclusive starts and exclusive ends at a tier boundary', () => {
    validateTierPeriods(periods);
    expect(tierAt(periods, account, new Date('2026-01-31T23:59:59Z'))).toBe('core');
    expect(tierAt(periods, account, new Date('2026-02-01T00:00:00Z'))).toBe('luxe');
  });

  it('rejects overlapping account periods', () => {
    const overlapping: TierPeriod[] = [...periods, { ...periods[1], validFrom: new Date('2026-01-15T00:00:00Z'), tier: 'pinnacle' }];
    expect(() => validateTierPeriods(overlapping)).toThrow(/Overlapping tier periods/);
  });

  it('reconstructs authoritative changes as half-open intervals and excludes business', () => {
    const transitions: TierTransition[] = [
      { cardAccount: account, tier: 'core', at: new Date('2026-01-01T00:00:00Z'), blockNumber: 1, logIndex: 0, arrayIndex: 0, qualifiedBy: 'unknown' },
      { cardAccount: account, tier: 'luxe', at: new Date('2026-02-01T00:00:00Z'), blockNumber: 2, logIndex: 0, arrayIndex: 0, qualifiedBy: 'unknown' },
      { cardAccount: account, tier: 'business', at: new Date('2026-03-01T00:00:00Z'), blockNumber: 3, logIndex: 0, arrayIndex: 0, qualifiedBy: 'unknown' },
    ];
    const rebuilt = reconstructTierPeriods('etherfi-cash', source.sourceId, source.provenance, transitions);
    expect(rebuilt.periods.map(({ tier, validTo }) => [tier, validTo?.toISOString()])).toEqual([
      ['core', '2026-02-01T00:00:00.000Z'],
      ['luxe', '2026-03-01T00:00:00.000Z'],
    ]);
    expect(rebuilt.current.get(account)).toBe('business');
  });

  it('collapses duplicate assignments without zero-length periods', () => {
    const at = new Date('2026-01-01T00:00:00Z');
    const transitions: TierTransition[] = [
      { cardAccount: account, tier: 'core', at, blockNumber: 1, logIndex: 0, arrayIndex: 0, qualifiedBy: 'unknown' },
      { cardAccount: account, tier: 'luxe', at, blockNumber: 1, logIndex: 1, arrayIndex: 0, qualifiedBy: 'unknown' },
    ];
    const rebuilt = reconstructTierPeriods('etherfi-cash', source.sourceId, source.provenance, transitions);
    expect(rebuilt.periods).toHaveLength(1);
    expect(rebuilt.periods[0]?.tier).toBe('luxe');
  });
});

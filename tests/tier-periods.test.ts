import { describe, expect, it } from 'vitest';
import { tierAt, validateTierPeriods } from '../packages/core/src/tier-periods';
import type { TierPeriod } from '../packages/core/src/types';

const account = '0x0000000000000000000000000000000000000001' as const;
const periods: TierPeriod[] = [
  { programId: 'etherfi-cash', cardAccount: account, tier: 'core', validFrom: new Date('2026-01-01T00:00:00Z'), validTo: new Date('2026-02-01T00:00:00Z'), qualifiedBy: 'unknown' },
  { programId: 'etherfi-cash', cardAccount: account, tier: 'luxe', validFrom: new Date('2026-02-01T00:00:00Z'), validTo: null, qualifiedBy: 'sethfi' },
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
});

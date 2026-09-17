import type { Tier, TierPeriod } from './types';

export function validateTierPeriods(periods: readonly TierPeriod[]): void {
  const grouped = new Map<string, TierPeriod[]>();
  for (const period of periods) {
    if (period.validTo && period.validTo <= period.validFrom) throw new Error('Tier period must end after it starts');
    const key = `${period.programId}:${period.cardAccount}`;
    const accountPeriods = grouped.get(key) ?? [];
    accountPeriods.push(period);
    grouped.set(key, accountPeriods);
  }
  for (const accountPeriods of grouped.values()) {
    accountPeriods.sort((a, b) => a.validFrom.getTime() - b.validFrom.getTime());
    for (let index = 1; index < accountPeriods.length; index += 1) {
      const previous = accountPeriods[index - 1];
      const current = accountPeriods[index];
      if (!previous || !current) continue;
      if (!previous.validTo || previous.validTo > current.validFrom) throw new Error(`Overlapping tier periods for ${current.cardAccount}`);
    }
  }
}

export function tierAt(periods: readonly TierPeriod[], account: string, at: Date): Tier | null {
  const period = periods.find((candidate) => candidate.cardAccount === account && candidate.validFrom <= at && (!candidate.validTo || candidate.validTo > at));
  return period?.tier ?? null;
}

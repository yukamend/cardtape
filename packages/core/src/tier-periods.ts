import type { FactProvenance, OnchainTier, Tier, TierPeriod, TierTransition } from './types';

export interface TierReconstruction {
  periods: TierPeriod[];
  current: Map<`0x${string}`, OnchainTier>;
}

function transitionOrder(left: TierTransition, right: TierTransition): number {
  return left.blockNumber - right.blockNumber || left.logIndex - right.logIndex || left.arrayIndex - right.arrayIndex;
}

export function reconstructTierPeriods(
  programId: string,
  sourceId: string,
  provenance: FactProvenance,
  transitions: readonly TierTransition[],
): TierReconstruction {
  const grouped = new Map<`0x${string}`, TierTransition[]>();
  for (const transition of transitions) {
    const cardAccount = transition.cardAccount.toLowerCase() as `0x${string}`;
    const rows = grouped.get(cardAccount) ?? [];
    rows.push({ ...transition, cardAccount });
    grouped.set(cardAccount, rows);
  }

  const periods: TierPeriod[] = [];
  const current = new Map<`0x${string}`, OnchainTier>();
  for (const [cardAccount, rows] of grouped) {
    rows.sort(transitionOrder);
    let active: TierPeriod | null = null;
    let activeTier: OnchainTier | null = null;
    for (const transition of rows) {
      if (transition.tier === activeTier) continue;
      if (active && transition.at > active.validFrom) active.validTo = transition.at;
      else if (active) periods.splice(periods.lastIndexOf(active), 1);
      active = null;
      activeTier = transition.tier;
      current.set(cardAccount, transition.tier);
      if (transition.tier === 'business') continue;
      active = {
        programId,
        cardAccount,
        tier: transition.tier,
        validFrom: transition.at,
        validTo: null,
        qualifiedBy: transition.qualifiedBy,
        sourceId,
        provenance,
      };
      periods.push(active);
    }
  }
  validateTierPeriods(periods);
  return { periods, current };
}

export function validateTierPeriods(periods: readonly TierPeriod[]): void {
  const grouped = new Map<string, TierPeriod[]>();
  for (const period of periods) {
    if (period.validTo && period.validTo <= period.validFrom) throw new Error('Tier period must end after it starts');
    const key = `${period.programId}:${period.cardAccount.toLowerCase()}`;
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

export function tierAt(periods: readonly TierPeriod[], account: string, at: Date, provenance?: FactProvenance): Tier | null {
  const normalizedAccount = account.toLowerCase();
  const period = periods.find((candidate) => candidate.cardAccount.toLowerCase() === normalizedAccount
    && (!provenance || candidate.provenance === provenance)
    && candidate.validFrom <= at
    && (!candidate.validTo || candidate.validTo > at));
  return period?.tier ?? null;
}

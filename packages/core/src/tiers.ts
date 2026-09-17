import type { Tier } from './types';

export interface TierDefinition {
  id: Tier;
  qualifyBy: readonly string[];
  cashbackRatePct: number;
  monthlyCapUsd: number;
  aboveCapRatesPct: readonly [number, number];
}

export const tierLadder = [
  { id: 'core', qualifyBy: ['free'], cashbackRatePct: 3, monthlyCapUsd: 2_000, aboveCapRatesPct: [1, 0.5] },
  { id: 'luxe', qualifyBy: ['5K monthly points', '$15K in Liquid', '30K ETHFI', '$199/year'], cashbackRatePct: 3, monthlyCapUsd: 10_000, aboveCapRatesPct: [1, 0.5] },
  { id: 'pinnacle', qualifyBy: ['25K monthly points', '$100K in Liquid', '150K ETHFI', '$999/year'], cashbackRatePct: 3, monthlyCapUsd: 50_000, aboveCapRatesPct: [1, 0.5] },
  { id: 'vip', qualifyBy: ['$500K in Liquid', '500K ETHFI'], cashbackRatePct: 4, monthlyCapUsd: 50_000, aboveCapRatesPct: [1, 0.5] },
] as const satisfies readonly TierDefinition[];

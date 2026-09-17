import type { Campaign, SpendEvent, TierEvent } from '../types';

const DAY_MS = 86_400_000;

export interface RetentionPoint {
  week: 4 | 8 | 12;
  retainedShare: number | null;
  retainedAccounts: number | null;
  cohortSize: number;
  observable: boolean;
}

export interface PersistenceEstimate {
  campaignId: string;
  cohortAccounts: readonly string[];
  baselineAccounts: readonly string[];
  campaign: readonly RetentionPoint[];
  baseline: readonly RetentionPoint[];
  stakerCohortSize: number;
  unstakedWithin30Days: number;
  unstakeShare: number | null;
}

function spendByAccount(events: readonly SpendEvent[]): Map<string, Date[]> {
  const result = new Map<string, Date[]>();
  for (const event of events) {
    if (event.eventType !== 'spend') continue;
    const dates = result.get(event.cardAccount) ?? [];
    dates.push(event.blockTime);
    result.set(event.cardAccount, dates);
  }
  for (const dates of result.values()) dates.sort((a, b) => a.getTime() - b.getTime());
  return result;
}

function campaignCohort(spend: ReadonlyMap<string, readonly Date[]>, campaign: Campaign): string[] {
  const result: string[] = [];
  for (const [account, dates] of spend) {
    const during = dates.some((date) => date >= campaign.startsAt && date < campaign.endsAt);
    if (!during) continue;
    const first = dates[0];
    const lastBefore = [...dates].reverse().find((date) => date < campaign.startsAt);
    const acquired = first !== undefined && first >= campaign.startsAt && first < campaign.endsAt;
    const reactivated = lastBefore === undefined || campaign.startsAt.getTime() - lastBefore.getTime() >= 28 * DAY_MS;
    if (acquired || reactivated) result.push(account);
  }
  return result;
}

function baselineCohort(spend: ReadonlyMap<string, readonly Date[]>, campaign: Campaign): string[] {
  const duration = campaign.endsAt.getTime() - campaign.startsAt.getTime();
  const end = new Date(campaign.startsAt.getTime() - 28 * DAY_MS);
  const start = new Date(end.getTime() - duration);
  return [...spend].filter(([, dates]) => dates[0] !== undefined && dates[0] >= start && dates[0] < end).map(([account]) => account);
}

function retentionPoints(spend: ReadonlyMap<string, readonly Date[]>, cohort: readonly string[], anchor: Date, datasetEnd: Date): RetentionPoint[] {
  return ([4, 8, 12] as const).map((week) => {
    const start = new Date(anchor.getTime() + week * 7 * DAY_MS);
    const end = new Date(start.getTime() + 7 * DAY_MS);
    if (datasetEnd < end) return { week, retainedShare: null, retainedAccounts: null, cohortSize: cohort.length, observable: false };
    const retainedAccounts = cohort.filter((account) => spend.get(account)?.some((date) => date >= start && date < end)).length;
    return { week, retainedShare: cohort.length === 0 ? 0 : retainedAccounts / cohort.length, retainedAccounts, cohortSize: cohort.length, observable: true };
  });
}

export function estimatePersistence(events: readonly SpendEvent[], tierEvents: readonly TierEvent[], campaign: Campaign): PersistenceEstimate {
  const spend = spendByAccount(events);
  const cohortAccounts = campaignCohort(spend, campaign);
  const baselineAccounts = baselineCohort(spend, campaign);
  const datasetEnd = events.reduce((latest, event) => event.blockTime > latest ? event.blockTime : latest, new Date(0));
  const stakeStart = new Date(campaign.startsAt.getTime() - 14 * DAY_MS);
  const stakers = new Set(tierEvents.filter((event) => event.blockTime >= stakeStart && event.blockTime < campaign.startsAt && ['stake', 'deposit'].includes(event.action)).map((event) => event.cardAccount));
  const unstakeEnd = new Date(campaign.endsAt.getTime() + 30 * DAY_MS);
  const unstaked = new Set(tierEvents.filter((event) => event.blockTime >= campaign.endsAt && event.blockTime <= unstakeEnd && ['unstake', 'withdraw'].includes(event.action) && stakers.has(event.cardAccount)).map((event) => event.cardAccount));
  return {
    campaignId: campaign.id,
    cohortAccounts,
    baselineAccounts,
    campaign: retentionPoints(spend, cohortAccounts, campaign.endsAt, datasetEnd),
    baseline: retentionPoints(spend, baselineAccounts, new Date(campaign.startsAt.getTime() - 28 * DAY_MS), datasetEnd),
    stakerCohortSize: stakers.size,
    unstakedWithin30Days: unstaked.size,
    unstakeShare: stakers.size === 0 ? null : unstaked.size / stakers.size,
  };
}

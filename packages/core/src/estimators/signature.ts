import { tierAt } from '../tier-periods';
import type { Campaign, SpendEvent, TierPeriod } from '../types';

const DAY_MS = 86_400_000;

export interface SignatureGroupResult {
  totalTransactions: number;
  matchingTransactions: number;
  matchingShare: number;
}

export interface SignatureEstimate {
  campaignId: string;
  eligibleDuring: SignatureGroupResult;
  eligibleBaseline: SignatureGroupResult;
  controlDuring: SignatureGroupResult;
  controlBaseline: SignatureGroupResult;
  normalizedEligibleCountLift: number;
  shareDifference: number;
  shareDifferenceCiLow: number;
  shareDifferenceCiHigh: number;
  histogram: readonly { lowerUsd: number; upperUsd: number | null; baseline: number; during: number }[];
  methodNote: string;
}

function matches(event: SpendEvent, campaign: Campaign): boolean {
  if (event.amountUsd === null) return false;
  const amount = Number(event.amountUsd);
  return (campaign.signature.minTicketUsd === undefined || amount >= campaign.signature.minTicketUsd)
    && (campaign.signature.maxTicketUsd === undefined || amount <= campaign.signature.maxTicketUsd);
}

function summarize(events: readonly SpendEvent[], campaign: Campaign): SignatureGroupResult {
  const matchingTransactions = events.filter((event) => matches(event, campaign)).length;
  return { totalTransactions: events.length, matchingTransactions, matchingShare: events.length === 0 ? 0 : matchingTransactions / events.length };
}

function accountsForTiers(periods: readonly TierPeriod[], campaign: Campaign, tiers: Campaign['eligibleTiers']): Set<string> {
  const accounts = new Set(periods.filter((period) => period.programId === campaign.programId).map((period) => period.cardAccount));
  return new Set([...accounts].filter((account) => {
    const tier = tierAt(periods, account, campaign.startsAt);
    return tier ? tiers.includes(tier) : false;
  }));
}

export function estimateSignatureMatch(events: readonly SpendEvent[], periods: readonly TierPeriod[], campaign: Campaign, baselineDays = 28): SignatureEstimate {
  const treated = accountsForTiers(periods, campaign, campaign.eligibleTiers);
  const control = accountsForTiers(periods, campaign, campaign.controlTiers);
  const baselineStart = new Date(campaign.startsAt.getTime() - baselineDays * DAY_MS);
  const inRange = (event: SpendEvent, accounts: ReadonlySet<string>, start: Date, end: Date) => event.eventType === 'spend' && event.blockTime >= start && event.blockTime < end && accounts.has(event.cardAccount);
  const eligibleDuringEvents = events.filter((event) => inRange(event, treated, campaign.startsAt, campaign.endsAt));
  const eligibleBaselineEvents = events.filter((event) => inRange(event, treated, baselineStart, campaign.startsAt));
  const controlDuringEvents = events.filter((event) => inRange(event, control, campaign.startsAt, campaign.endsAt));
  const controlBaselineEvents = events.filter((event) => inRange(event, control, baselineStart, campaign.startsAt));
  const eligibleDuring = summarize(eligibleDuringEvents, campaign);
  const eligibleBaseline = summarize(eligibleBaselineEvents, campaign);
  const controlDuring = summarize(controlDuringEvents, campaign);
  const controlBaseline = summarize(controlBaselineEvents, campaign);
  const campaignDays = Math.max(1, (campaign.endsAt.getTime() - campaign.startsAt.getTime()) / DAY_MS);
  const normalizedBaselineCount = eligibleBaseline.matchingTransactions * (campaignDays / baselineDays);
  const shareDifference = eligibleDuring.matchingShare - eligibleBaseline.matchingShare;
  const pooled = (eligibleDuring.matchingTransactions + eligibleBaseline.matchingTransactions) / Math.max(1, eligibleDuring.totalTransactions + eligibleBaseline.totalTransactions);
  const standardError = Math.sqrt(pooled * (1 - pooled) * (1 / Math.max(1, eligibleDuring.totalTransactions) + 1 / Math.max(1, eligibleBaseline.totalTransactions)));
  const threshold = campaign.signature.minTicketUsd ?? 1_000;
  const boundaries = [...new Set([0, 25, 50, 100, 250, 500, threshold, threshold * 1.5, threshold * 2, 5_000])].sort((a, b) => a - b);
  const histogram = boundaries.map((lowerUsd, index) => {
    const upperUsd = boundaries[index + 1] ?? null;
    const count = (rows: readonly SpendEvent[]) => rows.filter((event) => event.amountUsd !== null && Number(event.amountUsd) >= lowerUsd && (upperUsd === null || Number(event.amountUsd) < upperUsd)).length;
    return { lowerUsd, upperUsd, baseline: count(eligibleBaselineEvents), during: count(eligibleDuringEvents) };
  });
  return {
    campaignId: campaign.id,
    eligibleDuring,
    eligibleBaseline,
    controlDuring,
    controlBaseline,
    normalizedEligibleCountLift: eligibleDuring.matchingTransactions - normalizedBaselineCount,
    shareDifference,
    shareDifferenceCiLow: shareDifference - 1.96 * standardError,
    shareDifferenceCiHigh: shareDifference + 1.96 * standardError,
    histogram,
    methodNote: campaign.signature.note,
  };
}

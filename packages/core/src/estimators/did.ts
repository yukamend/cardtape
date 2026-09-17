import { tierAt } from '../tier-periods';
import type { Campaign, SpendEvent, TierPeriod } from '../types';
import { addMatrices, invertMatrix, linearSlope, multiplyMatrix, multiplyMatrixVector, outerProduct, transpose, zeroMatrix } from './statistics';

const DAY_MS = 86_400_000;

interface PanelRow {
  account: string;
  treated: number;
  post: number;
  outcome: number;
}

export type DidOutcome = 'volume' | 'transactions' | 'active_cards';

export interface DifferenceInDifferencesEstimate {
  campaignId: string;
  outcome: DidOutcome;
  estimable: boolean;
  reason: string | null;
  estimatePerAccountDay: number | null;
  totalIncremental: number | null;
  ciLow: number | null;
  ciHigh: number | null;
  standardError: number | null;
  treatedAccounts: number;
  controlAccounts: number;
  days: number;
  eligibleBeforeMean: number | null;
  eligibleDuringMean: number | null;
  controlBeforeMean: number | null;
  controlDuringMean: number | null;
  pretrendSlopeDifference: number | null;
  clusters: number;
}

function startOfUtcDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function daysBetween(start: Date, end: Date): number {
  return Math.max(1, Math.ceil((end.getTime() - start.getTime()) / DAY_MS));
}

function accountCohorts(periods: readonly TierPeriod[], campaign: Campaign): { treated: string[]; control: string[] } {
  const accounts = [...new Set(periods.filter((period) => period.programId === campaign.programId).map((period) => period.cardAccount))];
  const at = campaign.startsAt;
  return {
    treated: accounts.filter((account) => {
      const tier = tierAt(periods, account, at);
      return tier ? campaign.eligibleTiers.includes(tier) : false;
    }),
    control: accounts.filter((account) => {
      const tier = tierAt(periods, account, at);
      return tier ? campaign.controlTiers.includes(tier) : false;
    }),
  };
}

function dailyOutcome(events: readonly SpendEvent[], accounts: ReadonlySet<string>, start: Date, end: Date, outcome: DidOutcome): Map<string, number> {
  const result = new Map<string, number>();
  for (const event of events) {
    if (event.eventType !== 'spend' || event.blockTime < start || event.blockTime >= end || !accounts.has(event.cardAccount) || event.amountUsd === null) continue;
    const day = startOfUtcDay(event.blockTime).toISOString();
    const key = `${event.cardAccount}:${day}`;
    if (outcome === 'active_cards') result.set(key, 1);
    else result.set(key, (result.get(key) ?? 0) + (outcome === 'transactions' ? 1 : Number(event.amountUsd)));
  }
  return result;
}

function buildPanel(events: readonly SpendEvent[], periods: readonly TierPeriod[], campaign: Campaign, outcome: DidOutcome): { rows: PanelRow[]; treated: string[]; control: string[]; days: number } {
  const days = daysBetween(campaign.startsAt, campaign.endsAt);
  const duringStart = startOfUtcDay(campaign.startsAt);
  const duringEnd = new Date(duringStart.getTime() + days * DAY_MS);
  const beforeStart = new Date(duringStart.getTime() - days * DAY_MS);
  const cohorts = accountCohorts(periods, campaign);
  const allAccounts = new Set([...cohorts.treated, ...cohorts.control]);
  const spend = dailyOutcome(events, allAccounts, beforeStart, duringEnd, outcome);
  const rows: PanelRow[] = [];
  for (const [treated, accounts] of [[1, cohorts.treated], [0, cohorts.control]] as const) {
    for (const account of accounts) {
      for (let day = 0; day < days * 2; day += 1) {
        const date = new Date(beforeStart.getTime() + day * DAY_MS).toISOString();
        rows.push({ account, treated, post: day >= days ? 1 : 0, outcome: spend.get(`${account}:${date}`) ?? 0 });
      }
    }
  }
  return { rows, treated: cohorts.treated, control: cohorts.control, days };
}

function groupMean(rows: readonly PanelRow[], treated: number, post: number): number {
  const selected = rows.filter((row) => row.treated === treated && row.post === post);
  return selected.length === 0 ? 0 : selected.reduce((sum, row) => sum + row.outcome, 0) / selected.length;
}

function pretrendDifference(events: readonly SpendEvent[], periods: readonly TierPeriod[], campaign: Campaign, treated: readonly string[], control: readonly string[], outcome: DidOutcome): number {
  const end = startOfUtcDay(campaign.startsAt);
  const start = new Date(end.getTime() - 56 * DAY_MS);
  const all = new Set([...treated, ...control]);
  const spend = dailyOutcome(events, all, start, end, outcome);
  const groupSeries = (accounts: readonly string[]) => Array.from({ length: 56 }, (_, day) => {
    const date = new Date(start.getTime() + day * DAY_MS).toISOString();
    return accounts.reduce((sum, account) => sum + (spend.get(`${account}:${date}`) ?? 0), 0) / Math.max(1, accounts.length);
  });
  return linearSlope(groupSeries(treated)) - linearSlope(groupSeries(control));
}

export function estimateDifferenceInDifferences(events: readonly SpendEvent[], periods: readonly TierPeriod[], campaign: Campaign, outcome: DidOutcome = 'volume'): DifferenceInDifferencesEstimate {
  const panel = buildPanel(events, periods, campaign, outcome);
  if (panel.treated.length === 0 || panel.control.length === 0) {
    return { campaignId: campaign.id, outcome, estimable: false, reason: 'The campaign registry does not define both a treated and control cohort.', estimatePerAccountDay: null, totalIncremental: null, ciLow: null, ciHigh: null, standardError: null, treatedAccounts: panel.treated.length, controlAccounts: panel.control.length, days: panel.days, eligibleBeforeMean: null, eligibleDuringMean: null, controlBeforeMean: null, controlDuringMean: null, pretrendSlopeDifference: null, clusters: 0 };
  }
  const x = panel.rows.map((row) => [1, row.treated, row.post, row.treated * row.post]);
  const y = panel.rows.map((row) => row.outcome);
  const xt = transpose(x);
  const inverse = invertMatrix(multiplyMatrix(xt, x));
  const beta = multiplyMatrixVector(inverse, multiplyMatrixVector(xt, y));
  const residuals = y.map((outcome, index) => outcome - (x[index]?.reduce((sum, value, column) => sum + value * (beta[column] ?? 0), 0) ?? 0));
  const scores = new Map<string, number[]>();
  panel.rows.forEach((row, index) => {
    const score = scores.get(row.account) ?? [0, 0, 0, 0];
    x[index]?.forEach((value, column) => { score[column] = (score[column] ?? 0) + value * (residuals[index] ?? 0); });
    scores.set(row.account, score);
  });
  let meat = zeroMatrix(4);
  for (const score of scores.values()) meat = addMatrices(meat, outerProduct(score));
  const clusters = scores.size;
  const observations = panel.rows.length;
  const correction = clusters > 1 && observations > 4 ? (clusters / (clusters - 1)) * ((observations - 1) / (observations - 4)) : 1;
  const covariance = multiplyMatrix(multiplyMatrix(inverse, meat), inverse).map((row) => row.map((value) => value * correction));
  const perDay = beta[3] ?? 0;
  const perDaySe = Math.sqrt(Math.max(0, covariance[3]?.[3] ?? 0));
  const scale = panel.treated.length * panel.days;
  const total = perDay * scale;
  const totalSe = perDaySe * scale;
  return {
    campaignId: campaign.id,
    outcome,
    estimable: true,
    reason: null,
    estimatePerAccountDay: perDay,
    totalIncremental: total,
    ciLow: total - 1.96 * totalSe,
    ciHigh: total + 1.96 * totalSe,
    standardError: totalSe,
    treatedAccounts: panel.treated.length,
    controlAccounts: panel.control.length,
    days: panel.days,
    eligibleBeforeMean: groupMean(panel.rows, 1, 0),
    eligibleDuringMean: groupMean(panel.rows, 1, 1),
    controlBeforeMean: groupMean(panel.rows, 0, 0),
    controlDuringMean: groupMean(panel.rows, 0, 1),
    pretrendSlopeDifference: pretrendDifference(events, periods, campaign, panel.treated, panel.control, outcome),
    clusters,
  };
}

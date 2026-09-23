import type { CampaignImpact, CampaignMetric, ImpactVerdict } from './neobanks';

export interface RollingSpend {
  blockTime: string;
  cardAccount: string;
  amountUsd: string;
}

interface Window {
  start: string;
  end: string;
}

interface Summary {
  complete: boolean;
  first: number | null;
  last: number | null;
  volumePerDay: number;
  transactionsPerDay: number;
  activeAccountsPerDay: number;
}

const DAY = 86_400_000;

function utcDays(start: number, end: number): string[] {
  const days: string[] = [];
  const firstDay = new Date(start);
  for (let at = Date.UTC(firstDay.getUTCFullYear(), firstDay.getUTCMonth(), firstDay.getUTCDate()); at < end; at += DAY) {
    days.push(new Date(at).toISOString().slice(0, 10));
  }
  return days;
}

function summarize(spends: readonly RollingSpend[], window: Window): Summary {
  const start = Date.parse(window.start);
  const end = Date.parse(window.end);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) throw new Error('Invalid Cash snapshot window');
  const days = new Map<string, { accounts: Set<string>; count: number }>();
  let volumeUnits = 0;
  let first: number | null = null;
  let last: number | null = null;
  let transactions = 0;
  for (const spend of spends) {
    const at = Date.parse(spend.blockTime);
    if (at < start || at >= end) continue;
    const amount = Number(spend.amountUsd);
    if (!Number.isFinite(amount)) throw new Error('Invalid Cash spend amount in snapshot checkpoint');
    const day = new Date(at).toISOString().slice(0, 10);
    const entry = days.get(day) ?? { accounts: new Set<string>(), count: 0 };
    entry.accounts.add(spend.cardAccount);
    entry.count += 1;
    days.set(day, entry);
    volumeUnits += Math.round(amount * 10_000);
    transactions += 1;
    first = first === null ? at : Math.min(first, at);
    last = last === null ? at : Math.max(last, at);
  }
  const durationDays = (end - start) / DAY;
  const edgeTolerance = Math.min(3_600_000, (end - start) / 10);
  return {
    complete: first !== null && last !== null
      && first <= start + edgeTolerance && last >= end - edgeTolerance
      && utcDays(start, end).every((day) => days.has(day)),
    first, last,
    volumePerDay: volumeUnits / 10_000 / durationDays,
    transactionsPerDay: transactions / durationDays,
    activeAccountsPerDay: [...days.values()].reduce((sum, day) => sum + day.accounts.size, 0) / durationDays,
  };
}

function metric(input: {
  id: string; label: string; format: CampaignMetric['format'];
  campaign: number | null; baseline: number | null; updated: string; period: Window; interpretation: string;
}): CampaignMetric {
  const changeValue = input.campaign === null || input.baseline === null || input.baseline === 0
    ? null : ((input.campaign - input.baseline) / input.baseline) * 100;
  return {
    id: input.id, label: input.label, format: input.format,
    campaignValue: input.campaign, baselineValue: input.baseline,
    changeValue, changeUnit: 'percent', interpretation: input.interpretation,
    evidence: {
      kind: 'cached', confidence: 'high', sourceIds: ['etherfi-cash-events'],
      observationPeriod: input.period, lastUpdatedAt: input.updated,
      note: 'Finalized Optimism Cash Spend events. Values are observed program activity per 24 hours, not purchases attributable to this campaign. Published snapshot; incomplete windows are withheld.',
    },
  };
}

function coverageText(label: string, summary: Summary): string {
  if (summary.complete) return `${label}: measured settlements appear at both window boundaries and on every UTC day. This activity check is not a per-block scan audit.`;
  if (summary.first === null || summary.last === null) return `${label}: no finalized measured settlements are loaded for this window.`;
  return `${label}: loaded settlements span ${new Date(summary.first).toISOString()} to ${new Date(summary.last).toISOString()}; the requested window is incomplete.`;
}

export function rollingCashImpact(spends: readonly RollingSpend[], asOf: Date): CampaignImpact {
  const end = asOf.getTime();
  const start = end - DAY;
  const campaignPeriod = { start: new Date(start).toISOString(), end: asOf.toISOString() };
  const baselinePeriod = { start: new Date(start - DAY).toISOString(), end: new Date(start - 1).toISOString() };
  const during = summarize(spends, campaignPeriod);
  const before = summarize(spends, baselinePeriod);
  const last = Math.max(during.last ?? 0, before.last ?? 0);
  const updated = new Date(last || end).toISOString();
  const complete = during.complete && before.complete;
  const volumeChange = complete && before.volumePerDay > 0
    ? (during.volumePerDay - before.volumePerDay) / before.volumePerDay : null;
  const verdict: ImpactVerdict = volumeChange === null ? 'insufficient'
    : volumeChange > 0.05 ? 'positive' : volumeChange < -0.05 ? 'negative' : 'neutral';
  return {
    neobankId: 'etherfi-cash', campaignId: 'etherfi-cash-live', verdict,
    conclusion: complete
      ? 'Finalized onchain Cash settlement activity in the last 24 hours versus the prior 24 hours. This is program activity, not a campaign effect.'
      : 'Measured onchain history does not yet cover both comparison windows. A readout will appear after the historical backfill is complete.',
    campaignPeriod, baselinePeriod,
    metrics: [
      metric({ id: 'settlement-volume', label: 'Settlement volume / day', format: 'currency', campaign: during.complete ? during.volumePerDay : null, baseline: before.complete ? before.volumePerDay : null, updated, period: campaignPeriod, interpretation: 'Daily average of finalized onchain settlement USD.' }),
      metric({ id: 'settlements', label: 'Settlements / day', format: 'number', campaign: during.complete ? during.transactionsPerDay : null, baseline: before.complete ? before.transactionsPerDay : null, updated, period: campaignPeriod, interpretation: 'Daily average number of Cash Spend events.' }),
      metric({ id: 'active-accounts', label: 'Active account-days / day', format: 'number', campaign: during.complete ? during.activeAccountsPerDay : null, baseline: before.complete ? before.activeAccountsPerDay : null, updated, period: campaignPeriod, interpretation: 'Sum of distinct Safe accounts on each UTC day, divided by the window length. An account active on two UTC dates contributes twice.' }),
    ],
    trend: [],
    limitations: [
      coverageText('Campaign', during), coverageText('Baseline', before),
      'Merchant, MCC, location, card authorization and campaign identity are absent from these onchain settlements.',
      'The comparison is observational and does not establish a causal campaign effect.',
    ],
  };
}

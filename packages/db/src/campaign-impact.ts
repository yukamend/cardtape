import type { Pool } from 'pg';
import type { CampaignImpact, CampaignMetric, CampaignTrendPoint, ImpactVerdict } from '../../core/src/neobanks';
import { getNeobankCampaign } from '../../core/src/neobanks';
import { OPTIMISM_SOURCE_ID } from '../../adapters/src/optimism';

export interface CampaignWindow {
  start: string;
  end: string;
}

interface DailyRow {
  day: string;
  transactions: string;
  volume_usd: string;
  active_accounts: string;
  first_spend_at: Date;
  last_spend_at: Date;
}

interface WindowSummary {
  rows: DailyRow[];
  first: Date | null;
  last: Date | null;
  complete: boolean;
  durationDays: number;
  volumePerDay: number;
  transactionsPerDay: number;
  activeAccountsPerDay: number;
}

function utcDays(start: Date, end: Date): string[] {
  const days: string[] = [];
  const cursor = Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate());
  for (let at = cursor; at < end.getTime(); at += 86_400_000) days.push(new Date(at).toISOString().slice(0, 10));
  return days;
}

async function loadWindow(pool: Pool, window: CampaignWindow): Promise<WindowSummary> {
  const start = new Date(window.start);
  const end = new Date(window.end);
  if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || end <= start) throw new Error('Invalid campaign observation window');
  const durationDays = (end.getTime() - start.getTime()) / 86_400_000;
  const result = await pool.query<DailyRow>(`
    SELECT to_char(block_time AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS day,
      count(*)::text AS transactions,
      coalesce(sum(amount_usd), 0)::text AS volume_usd,
      count(DISTINCT card_account)::text AS active_accounts,
      min(block_time) AS first_spend_at,
      max(block_time) AS last_spend_at
    FROM spend_event
    WHERE source_id = $1 AND provenance = 'measured' AND finalized = true
      AND event_type = 'spend' AND block_time >= $2 AND block_time < $3
    GROUP BY 1 ORDER BY 1
  `, [OPTIMISM_SOURCE_ID, start, end]);
  const rows = result.rows;
  const first = rows[0]?.first_spend_at ?? null;
  const last = rows.at(-1)?.last_spend_at ?? null;
  const observedDays = new Set(rows.map((row) => row.day));
  const days = utcDays(start, end);
  // Dense settlement activity provides a conservative coverage gate until a
  // per-block scan ledger is available. Missing days or boundaries suppress KPIs.
  const edgeTolerance = Math.min(3_600_000, (end.getTime() - start.getTime()) / 10);
  const complete = first !== null && last !== null
    && first.getTime() <= start.getTime() + edgeTolerance
    && last.getTime() >= end.getTime() - edgeTolerance
    && days.every((day) => observedDays.has(day));
  const sum = (key: 'transactions' | 'volume_usd' | 'active_accounts') => rows.reduce((total, row) => total + Number(row[key]), 0);
  return {
    rows, first, last, complete, durationDays,
    volumePerDay: sum('volume_usd') / durationDays,
    transactionsPerDay: sum('transactions') / durationDays,
    activeAccountsPerDay: sum('active_accounts') / durationDays,
  };
}

function metric(input: {
  id: string;
  label: string;
  format: CampaignMetric['format'];
  campaign: number | null;
  baseline: number | null;
  updated: string;
  period: CampaignWindow;
  interpretation: string;
}): CampaignMetric {
  const changeValue = input.campaign === null || input.baseline === null || input.baseline === 0
    ? null : ((input.campaign - input.baseline) / input.baseline) * 100;
  return {
    id: input.id, label: input.label, format: input.format,
    campaignValue: input.campaign, baselineValue: input.baseline,
    changeValue, changeUnit: 'percent', interpretation: input.interpretation,
    evidence: {
      kind: 'live', confidence: 'high', sourceIds: ['etherfi-cash-events'],
      observationPeriod: input.period, lastUpdatedAt: input.updated,
      note: 'Finalized Optimism Cash Spend events. Values are observed program activity per 24 hours, not purchases attributable to this campaign. Incomplete windows are withheld.',
    },
  };
}

function coverageText(label: string, summary: WindowSummary): string {
  if (summary.complete) return `${label}: measured settlements appear at both window boundaries and on every UTC day. This activity check is not a per-block scan audit.`;
  if (!summary.first || !summary.last) return `${label}: no finalized measured settlements are loaded for this window.`;
  return `${label}: loaded settlements span ${summary.first.toISOString()} to ${summary.last.toISOString()}; the requested window is incomplete.`;
}

export async function loadEtherfiImpact(
  pool: Pool,
  campaignId: string,
  campaignPeriod: CampaignWindow,
  baselinePeriod: CampaignWindow,
): Promise<CampaignImpact> {
  const campaign = getNeobankCampaign(campaignId);
  if (campaign.neobankId !== 'etherfi-cash') throw new Error('Not an ether.fi campaign');
  if (campaignId === 'etherfi-cash-live') {
    const start = new Date(campaignPeriod.start).getTime();
    const end = new Date(campaignPeriod.end).getTime();
    const baselineStart = new Date(baselinePeriod.start).getTime();
    const baselineEnd = new Date(baselinePeriod.end).getTime();
    if (end - start !== 86_400_000 || start - baselineStart !== 86_400_000 || baselineEnd !== start - 1
      || end > Date.now() + 60_000 || end < Date.now() - 5 * 60_000) throw new Error('Invalid live Cash window');
  } else if (campaignPeriod.start !== campaign.startsAt || campaignPeriod.end !== campaign.endsAt) {
    throw new Error('Campaign window does not match the registry');
  }
  const [during, before] = await Promise.all([loadWindow(pool, campaignPeriod), loadWindow(pool, baselinePeriod)]);
  const last = [during.last, before.last].filter((date): date is Date => date !== null).sort((a, b) => b.getTime() - a.getTime())[0];
  const updated = (last ?? new Date()).toISOString();
  const complete = during.complete && before.complete;
  const volumeChange = complete && before.volumePerDay > 0 ? (during.volumePerDay - before.volumePerDay) / before.volumePerDay : null;
  const verdict: ImpactVerdict = volumeChange === null ? 'insufficient' : volumeChange > 0.05 ? 'positive' : volumeChange < -0.05 ? 'negative' : 'neutral';
  const metrics = [
    metric({ id: 'settlement-volume', label: 'Settlement volume / day', format: 'currency', campaign: during.complete ? during.volumePerDay : null, baseline: before.complete ? before.volumePerDay : null, updated, period: campaignPeriod, interpretation: 'Daily average of finalized onchain settlement USD.' }),
    metric({ id: 'settlements', label: 'Settlements / day', format: 'number', campaign: during.complete ? during.transactionsPerDay : null, baseline: before.complete ? before.transactionsPerDay : null, updated, period: campaignPeriod, interpretation: 'Daily average number of Cash Spend events.' }),
    metric({ id: 'active-accounts', label: 'Active account-days / day', format: 'number', campaign: during.complete ? during.activeAccountsPerDay : null, baseline: before.complete ? before.activeAccountsPerDay : null, updated, period: campaignPeriod, interpretation: 'Sum of distinct Safe accounts on each UTC day, divided by the window length. An account active on two UTC dates contributes twice.' }),
  ];
  const trend: CampaignTrendPoint[] = complete && campaignId !== 'etherfi-cash-live'
    ? [...before.rows.map((row) => ({ row, phase: 'baseline' as const })), ...during.rows.map((row) => ({ row, phase: 'campaign' as const }))]
      .map(({ row, phase }) => ({ date: `${row.day}T00:00:00.000Z`, value: Number(row.volume_usd), phase }))
    : [];
  return {
    neobankId: 'etherfi-cash', campaignId, verdict,
    conclusion: complete
      ? campaignId === 'etherfi-cash-live'
        ? 'Finalized onchain Cash settlement activity in the last 24 hours versus the prior 24 hours. This is program activity, not a campaign effect.'
        : 'Finalized onchain settlements changed during this window. The comparison is descriptive; the chain does not identify the merchant or campaign for each purchase.'
      : 'Measured onchain history does not yet cover both comparison windows. A readout will appear after the historical backfill is complete.',
    campaignPeriod, baselinePeriod, metrics, trend,
    limitations: [
      coverageText('Campaign', during), coverageText('Baseline', before),
      'Merchant, MCC, location, card authorization and campaign identity are absent from these onchain settlements.',
      'The comparison is observational and does not establish a causal campaign effect.',
    ],
  };
}

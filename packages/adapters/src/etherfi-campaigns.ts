import type { CampaignImpact, CampaignMetric, ImpactVerdict } from '../../core/src/neobanks';
import type { CampaignMetricsQuery } from './campaign-metrics';

interface EtherfiFixture {
  verdict: ImpactVerdict;
  conclusion: string;
  values: Array<{
    id: string;
    label: string;
    format: CampaignMetric['format'];
    campaign: number;
    baseline: number;
    changeUnit?: CampaignMetric['changeUnit'];
    confidence: CampaignMetric['evidence']['confidence'];
    kind: CampaignMetric['evidence']['kind'];
    interpretation: string;
  }>;
}

const fixtures: Record<string, EtherfiFixture> = {
  'etherfi-iphone18-preorder': {
    verdict: 'positive',
    conclusion: 'Demo analysis indicates higher observable settlement activity during the campaign window.',
    values: [
      { id: 'new-accounts', label: 'First-time active accounts', format: 'count', campaign: 184, baseline: 139, confidence: 'medium', kind: 'demo', interpretation: 'More accounts recorded a first settlement during the campaign window.' },
      { id: 'active-accounts', label: 'Active card accounts', format: 'count', campaign: 2418, baseline: 1835, confidence: 'medium', kind: 'demo', interpretation: 'More card accounts were active than in the comparison period.' },
      { id: 'settlement-volume', label: 'Settlement volume', format: 'currency', campaign: 1_840_000, baseline: 1_397_000, confidence: 'medium', kind: 'demo', interpretation: 'Finalized settlement value was higher during the campaign.' },
      { id: 'repeat-activity', label: 'Repeat activity', format: 'percent', campaign: 41.2, baseline: 32.8, changeUnit: 'percentage-points', confidence: 'low', kind: 'estimated', interpretation: 'The demo cohort returned more often, but it is still maturing.' },
    ],
  },
  'etherfi-lunar-new-year-2026': {
    verdict: 'positive',
    conclusion: 'Demo analysis shows a moderate increase in observable settlement activity.',
    values: [
      { id: 'new-accounts', label: 'First-time active accounts', format: 'count', campaign: 128, baseline: 101, confidence: 'low', kind: 'inferred', interpretation: 'First-settlement timing suggests more newly active accounts.' },
      { id: 'active-accounts', label: 'Active card accounts', format: 'count', campaign: 1682, baseline: 1421, confidence: 'medium', kind: 'demo', interpretation: 'The campaign window contained more active accounts.' },
      { id: 'settlement-volume', label: 'Settlement volume', format: 'currency', campaign: 1_210_000, baseline: 1_022_000, confidence: 'medium', kind: 'demo', interpretation: 'Observed settlement volume increased against baseline.' },
      { id: 'rewards', label: 'Rewards distributed', format: 'currency', campaign: 16842, baseline: 0, confidence: 'high', kind: 'demo', interpretation: 'The demo snapshot includes campaign-period reward distributions.' },
    ],
  },
  'etherfi-membership-rewards-2025': {
    verdict: 'neutral',
    conclusion: 'Observable activity was broadly unchanged and evidence is not strong enough for attribution.',
    values: [
      { id: 'active-accounts', label: 'Active card accounts', format: 'count', campaign: 1134, baseline: 1119, confidence: 'medium', kind: 'demo', interpretation: 'Account activity stayed close to the comparison period.' },
      { id: 'settlement-volume', label: 'Settlement volume', format: 'currency', campaign: 932000, baseline: 921000, confidence: 'medium', kind: 'demo', interpretation: 'Settlement value moved only slightly.' },
      { id: 'rewards', label: 'Rewards distributed', format: 'currency', campaign: 48320, baseline: 0, confidence: 'high', kind: 'demo', interpretation: 'Rewards are observable; incremental impact is not established.' },
      { id: 'repeat-activity', label: 'Repeat activity', format: 'percent', campaign: 36.7, baseline: 35.9, changeUnit: 'percentage-points', confidence: 'low', kind: 'estimated', interpretation: 'Repeat activity was effectively flat.' },
    ],
  },
};

function change(campaign: number, baseline: number, unit: CampaignMetric['changeUnit']): number | null {
  if (unit === 'percentage-points') return campaign - baseline;
  return baseline === 0 ? null : ((campaign - baseline) / baseline) * 100;
}

function trend(campaignPeriod: CampaignMetricsQuery['campaignPeriod'], baselinePeriod: CampaignMetricsQuery['baselinePeriod']) {
  const points = [72, 75, 71, 78, 76, 81, 79, 86, 94, 102, 109, 112, 101, 98, 96, 99];
  const baselineStart = new Date(baselinePeriod.start).getTime();
  const campaignStart = new Date(campaignPeriod.start).getTime();
  const campaignEnd = new Date(campaignPeriod.end).getTime();
  const step = Math.max(86_400_000, Math.floor((campaignEnd - baselineStart) / 13));
  return points.map((value, index) => {
    const at = baselineStart + step * index;
    return { date: new Date(at).toISOString(), value, phase: at < campaignStart ? 'baseline' as const : at <= campaignEnd ? 'campaign' as const : 'after' as const };
  });
}

export function createEtherfiImpact(query: CampaignMetricsQuery): CampaignImpact {
  const fixture = fixtures[query.campaignId];
  if (!fixture) throw new Error(`No ether.fi campaign fixture for ${query.campaignId}`);
  const lastUpdatedAt = query.campaignId === 'etherfi-iphone18-preorder'
    ? '2026-09-19T04:30:00.000Z'
    : query.campaignPeriod.end;
  return {
    neobankId: query.neobankId,
    campaignId: query.campaignId,
    verdict: fixture.verdict,
    conclusion: fixture.conclusion,
    campaignPeriod: query.campaignPeriod,
    baselinePeriod: query.baselinePeriod,
    metrics: fixture.values.map((metric) => {
      const changeUnit = metric.changeUnit ?? 'percent';
      return {
        id: metric.id,
        label: metric.label,
        format: metric.format,
        campaignValue: metric.campaign,
        baselineValue: metric.baseline,
        changeValue: change(metric.campaign, metric.baseline, changeUnit),
        changeUnit,
        interpretation: metric.interpretation,
        evidence: {
          kind: metric.kind,
          confidence: metric.confidence,
          sourceIds: ['etherfi-cash-events', 'etherfi-campaign-registry'],
          observationPeriod: query.campaignPeriod,
          lastUpdatedAt,
          note: metric.kind === 'demo'
            ? 'Demonstration snapshot shaped like the normalized output of the existing ether.fi adapter.'
            : 'Model-derived result; it does not prove that the campaign caused the change.',
        },
      };
    }),
    trend: trend(query.campaignPeriod, query.baselinePeriod),
    limitations: [
      'Campaign and merchant identity are not present in settlement events.',
      'Results describe observed correlation unless a defensible control is available.',
      'Values shown in this interface are labeled demo or estimated; the existing live event pipeline remains available as a source.',
    ],
  };
}

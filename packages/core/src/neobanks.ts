export type EvidenceKind = 'live' | 'cached' | 'inferred' | 'estimated' | 'demo';
export type EvidenceConfidence = 'high' | 'medium' | 'low';
export type CampaignStatus = 'active' | 'complete' | 'unavailable' | 'demonstration';
export type ImpactVerdict = 'positive' | 'neutral' | 'negative' | 'insufficient';
export type MetricFormat = 'count' | 'currency' | 'percent' | 'number';

export interface DataSource {
  id: string;
  neobankId: string;
  name: string;
  kind: EvidenceKind;
  description: string;
  methodology: string;
  networks: readonly string[];
  signals: readonly string[];
}

export interface Neobank {
  id: string;
  name: string;
  shortName: string;
  description: string;
  accent: string;
  sourceIds: readonly string[];
}

export interface NeobankCampaign {
  id: string;
  neobankId: string;
  name: string;
  shortName: string;
  description: string;
  startsAt: string;
  endsAt: string;
  status: CampaignStatus;
  officialCampaign: boolean;
  sourceUrl?: string;
}

export interface MetricEvidence {
  kind: EvidenceKind;
  confidence: EvidenceConfidence;
  sourceIds: readonly string[];
  observationPeriod: { start: string; end: string };
  lastUpdatedAt: string;
  note: string;
}

export interface CampaignMetric {
  id: string;
  label: string;
  format: MetricFormat;
  campaignValue: number | null;
  baselineValue: number | null;
  changeValue: number | null;
  changeUnit: 'percent' | 'percentage-points';
  interpretation: string;
  evidence: MetricEvidence;
}

export interface CampaignTrendPoint {
  date: string;
  value: number;
  phase: 'baseline' | 'campaign' | 'after';
}

export interface CampaignImpact {
  neobankId: string;
  campaignId: string;
  verdict: ImpactVerdict;
  conclusion: string;
  campaignPeriod: { start: string; end: string };
  baselinePeriod: { start: string; end: string };
  metrics: readonly CampaignMetric[];
  trend: readonly CampaignTrendPoint[];
  limitations: readonly string[];
}

export const dataSources: readonly DataSource[] = [
  {
    id: 'etherfi-cash-events',
    neobankId: 'etherfi-cash',
    name: 'ether.fi Cash events',
    kind: 'cached',
    description: 'Published snapshot of finalized card settlement, cashback, account and tier events.',
    methodology: 'The local Optimism adapter normalizes finalized contract events before a static snapshot is published. Merchant identity is not emitted.',
    networks: ['Optimism'],
    signals: ['Spend settlements', 'Cashback', 'Safe creation', 'Tier assignments'],
  },
  {
    id: 'etherfi-campaign-registry',
    neobankId: 'etherfi-cash',
    name: 'ether.fi campaign registry',
    kind: 'cached',
    description: 'Versioned campaign windows, eligibility and public offer sources.',
    methodology: 'Campaign definitions retain the existing public source URLs and honest signature limitations.',
    networks: [],
    signals: ['Campaign dates', 'Eligibility', 'Stated rewards'],
  },
  {
    id: 'plasma-one-lock-vault',
    neobankId: 'plasma-one',
    name: 'Plasma One XPL lock vault',
    kind: 'cached',
    description: 'Published snapshot of finalized Locked events from the Plasma One membership vault.',
    methodology: 'Vault locks are observable. A 100,000 WXPL lock is Platinum-sized; top-ups can also unlock Platinum. Neither confirms signup, card activation or FX charges.',
    networks: ['Plasma'],
    signals: ['WXPL vault locks', 'Platinum-sized lock proxy'],
  },
] as const;

export const neobanks: readonly Neobank[] = [
  {
    id: 'etherfi-cash',
    name: 'ether.fi Cash',
    shortName: 'ether.fi',
    description: 'Card settlement and rewards campaign measurement using the existing verified event pipeline.',
    accent: '#d9ff72',
    sourceIds: ['etherfi-cash-events', 'etherfi-campaign-registry'],
  },
  {
    id: 'plasma-one',
    name: 'Plasma One',
    shortName: 'Plasma',
    description: 'Onchain membership lock activity from the Plasma One vault.',
    accent: '#8db8ff',
    sourceIds: ['plasma-one-lock-vault'],
  },
] as const;

export const neobankCampaigns: readonly NeobankCampaign[] = [
  {
    id: 'etherfi-cash-live',
    neobankId: 'etherfi-cash',
    name: 'Cash activity monitor',
    shortName: 'Cash activity',
    description: 'The latest published 24-hour onchain Cash settlement window compared with its preceding 24 hours. This measures program activity, not a specific promotion.',
    startsAt: '2026-09-21T00:00:00.000Z',
    endsAt: '2026-09-23T00:00:00.000Z',
    status: 'active',
    officialCampaign: false,
  },
  {
    id: 'etherfi-iphone18-preorder',
    neobankId: 'etherfi-cash',
    name: 'iPhone 18 pre-order',
    shortName: 'iPhone 18 pre-order',
    description: 'Cashback lottery for eligible card tiers, measured against pre-campaign settlement activity.',
    startsAt: '2026-09-12T13:00:00.000Z',
    endsAt: '2026-09-19T03:59:00.000Z',
    status: 'complete',
    officialCampaign: true,
    sourceUrl: 'https://etherfi.gitbook.io/etherfi/events/events/apple-iphone-18-pre-order-promo',
  },
  {
    id: 'etherfi-lunar-new-year-2026',
    neobankId: 'etherfi-cash',
    name: 'Lunar New Year 2026',
    shortName: 'Lunar New Year',
    description: 'Referral cashback window, evaluated using qualifying settlement and first-activity proxies.',
    startsAt: '2026-02-08T00:00:00.000Z',
    endsAt: '2026-03-01T00:00:00.000Z',
    status: 'unavailable',
    officialCampaign: true,
    sourceUrl: 'https://etherfi.gitbook.io/etherfi/events/events/lunar-new-year-2026',
  },
  {
    id: 'etherfi-membership-rewards-2025',
    neobankId: 'etherfi-cash',
    name: 'Membership Rewards',
    shortName: 'Membership Rewards',
    description: 'A descriptive readout of member cashback and repeat settlement behavior.',
    startsAt: '2025-06-01T00:00:00.000Z',
    endsAt: '2025-09-01T00:00:00.000Z',
    status: 'unavailable',
    officialCampaign: true,
    sourceUrl: 'https://etherfi.gitbook.io/etherfi/events/events/membership-rewards',
  },
  {
    id: 'plasma-one-platinum-locks',
    neobankId: 'plasma-one',
    name: 'Platinum lock monitor',
    shortName: 'Platinum locks',
    description: 'The latest published seven-day view of XPL locks after Platinum introduced no added FX fees. Locks are a proxy for upgrades, not confirmed signups.',
    startsAt: '2026-09-16T00:00:00.000Z',
    endsAt: '2026-09-23T00:00:00.000Z',
    status: 'active',
    officialCampaign: false,
    sourceUrl: 'https://www.plasma.org/personal/platinum',
  },
] as const;

export function getNeobank(id: string): Neobank {
  const neobank = neobanks.find((candidate) => candidate.id === id);
  if (!neobank) throw new Error(`Unknown neobank: ${id}`);
  return neobank;
}

export function getNeobankCampaign(id: string): NeobankCampaign {
  const campaign = neobankCampaigns.find((candidate) => candidate.id === id);
  if (!campaign) throw new Error(`Unknown neobank campaign: ${id}`);
  return campaign;
}

export function getCampaignsForNeobank(neobankId: string): readonly NeobankCampaign[] {
  return neobankCampaigns.filter((campaign) => campaign.neobankId === neobankId);
}

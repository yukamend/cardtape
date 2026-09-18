export type Tier = 'core' | 'luxe' | 'pinnacle' | 'vip';
export type SettlementCurrency = 'USD' | 'EUR' | 'GBP';
export type MetricProvenance = 'measured' | 'inferred' | 'estimated' | 'demo';
export type FactProvenance = 'measured' | 'demo';
export type CampaignMechanic =
  | 'cashback_pct'
  | 'cashback_lottery'
  | 'referral'
  | 'tier_boost'
  | 'card_drop';

export interface CampaignSignature {
  minTicketUsd?: number;
  maxTicketUsd?: number;
  note: string;
}

export interface Campaign {
  id: string;
  programId: string;
  name: string;
  sourceUrl: string;
  announcedAt?: Date;
  startsAt: Date;
  endsAt: Date;
  payoutAt?: Date;
  mechanic: CampaignMechanic;
  eligibleTiers: readonly Tier[];
  controlTiers: readonly Tier[];
  region?: string;
  statedBudgetUsd?: number;
  signature: CampaignSignature;
  methodNote: string;
}

export type SpendEventType = 'spend' | 'top_up' | 'cashback' | 'settlement';

export interface SpendEvent {
  chainId: number;
  txHash: `0x${string}`;
  logIndex: number;
  blockNumber: number;
  blockTime: Date;
  eventType: SpendEventType;
  programId: string;
  cardAccount: `0x${string}`;
  tokenSymbol: string;
  decimals: number;
  amountRaw: string;
  settlementCcy: SettlementCurrency;
  amountUsd: string | null;
  priceSource: string | null;
  pricedAt: Date | null;
  sourceId: string;
  provenance: FactProvenance;
  finalized: boolean;
}

export type TierQualification = 'sethfi' | 'liquid' | 'points' | 'paid' | 'unknown';

export interface TierPeriod {
  programId: string;
  cardAccount: `0x${string}`;
  tier: Tier;
  validFrom: Date;
  validTo: Date | null;
  qualifiedBy: TierQualification;
  sourceId: string;
  provenance: FactProvenance;
}

export type OnchainTier = Tier | 'business';

export interface TierTransition {
  cardAccount: `0x${string}`;
  tier: OnchainTier;
  at: Date;
  blockNumber: number;
  logIndex: number;
  arrayIndex: number;
  qualifiedBy: TierQualification;
}

export type TierAction = 'stake' | 'unstake' | 'deposit' | 'withdraw';

export interface TierEvent {
  chainId: number;
  txHash: `0x${string}`;
  logIndex: number;
  blockNumber: number;
  blockTime: Date;
  programId: string;
  cardAccount: `0x${string}`;
  action: TierAction;
  asset: 'ETHFI' | 'LIQUID';
  amountRaw: string;
  sourceId: string;
  provenance: FactProvenance;
  finalized: boolean;
}

export interface MarketPrice {
  sourceId: string;
  symbol: 'ETHFI' | 'BTC';
  observedAt: Date;
  priceUsd: string;
  volumeUsd: string;
  provenance: FactProvenance;
}

export interface CampaignResult {
  campaignId: string;
  metric: string;
  value: string | null;
  ciLow: string | null;
  ciHigh: string | null;
  provenance: MetricProvenance;
  methodNote: string;
  computedAt: Date;
}

export interface Cursor {
  blockNumber: number;
  blockHash: `0x${string}` | null;
}

export interface RawEvent {
  payload: unknown;
}

export interface SpendSource {
  id: string;
  kind: FactProvenance;
  fetch(cursor: Cursor, limit: number): Promise<{ events: RawEvent[]; cursor: Cursor }>;
  subscribe?(onEvent: (event: RawEvent) => void): () => void;
  normalize(raw: RawEvent): SpendEvent[];
}

export interface InjectedCampaignGroundTruth {
  campaignId: string;
  incrementalTransactions: number;
  incrementalVolumeUsd: string;
  qualifyingSignatureTransactions: number;
  cashbackCostUsd: string;
}

export interface SyntheticDataset {
  seed: string;
  generatedAt: Date;
  startsAt: Date;
  endsAt: Date;
  spendEvents: readonly SpendEvent[];
  tierPeriods: readonly TierPeriod[];
  tierEvents: readonly TierEvent[];
  marketPrices: readonly MarketPrice[];
  campaignResults: readonly CampaignResult[];
  groundTruth: readonly InjectedCampaignGroundTruth[];
}

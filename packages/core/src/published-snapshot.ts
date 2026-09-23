import type { CampaignImpact } from './neobanks';
import type { TapeEvent } from './tape';

export interface PublishedSnapshot {
  version: 1;
  generatedAt: string;
  optimism: {
    blockNumber: number;
    indexedAt: string;
    tierBlockNumber: number | null;
    tiersIndexedAt: string | null;
  };
  tape: TapeEvent[];
  campaigns: Record<string, Record<string, CampaignImpact>>;
}

export function isPublishedSnapshot(value: unknown): value is PublishedSnapshot {
  if (typeof value !== 'object' || value === null) return false;
  const snapshot = value as Partial<PublishedSnapshot>;
  return snapshot.version === 1
    && typeof snapshot.generatedAt === 'string'
    && Number.isFinite(Date.parse(snapshot.generatedAt))
    && typeof snapshot.optimism?.blockNumber === 'number'
    && typeof snapshot.optimism.indexedAt === 'string'
    && (snapshot.optimism.tierBlockNumber === null || typeof snapshot.optimism.tierBlockNumber === 'number')
    && (snapshot.optimism.tiersIndexedAt === null || typeof snapshot.optimism.tiersIndexedAt === 'string')
    && Array.isArray(snapshot.tape)
    && typeof snapshot.campaigns === 'object'
    && snapshot.campaigns !== null;
}

export function snapshotImpact(snapshot: PublishedSnapshot | null, campaignId: string, baselineDays: number): CampaignImpact | null {
  if (!snapshot) return null;
  return snapshot.campaigns[campaignId]?.[String(baselineDays)] ?? null;
}

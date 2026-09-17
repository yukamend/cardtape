import type { Campaign, CampaignResult, Cursor, MarketPrice, SpendEvent, TierEvent, TierPeriod } from '../../core/src/types';
import type { Database } from './client';
import { campaign, campaignResult, ingestCursor, marketPrice, spendEvent, tierEvent, tierPeriod } from './schema';

const BATCH_SIZE = 1_000;

export function spendEventKey(event: Pick<SpendEvent, 'chainId' | 'txHash' | 'logIndex'>): string {
  return `${event.chainId}:${event.txHash}:${event.logIndex}`;
}

export function deduplicateSpendEvents(events: readonly SpendEvent[]): SpendEvent[] {
  const unique = new Map<string, SpendEvent>();
  for (const event of events) unique.set(spendEventKey(event), event);
  return [...unique.values()];
}

function batches<T>(rows: readonly T[], size = BATCH_SIZE): T[][] {
  const result: T[][] = [];
  for (let index = 0; index < rows.length; index += size) result.push(rows.slice(index, index + size));
  return result;
}

export async function upsertCampaignRegistry(db: Database, rows: readonly Campaign[]): Promise<void> {
  for (const row of rows) {
    await db.insert(campaign).values({
      id: row.id,
      programId: row.programId,
      name: row.name,
      sourceUrl: row.sourceUrl,
      announcedAt: row.announcedAt ?? null,
      startsAt: row.startsAt,
      endsAt: row.endsAt,
      payoutAt: row.payoutAt ?? null,
      mechanic: row.mechanic,
      eligibleTiers: [...row.eligibleTiers],
      controlTiers: [...row.controlTiers],
      region: row.region ?? null,
      statedBudgetUsd: row.statedBudgetUsd?.toFixed(4) ?? null,
      signature: row.signature,
      methodNote: row.methodNote,
    }).onConflictDoUpdate({
      target: campaign.id,
      set: {
        name: row.name,
        sourceUrl: row.sourceUrl,
        announcedAt: row.announcedAt ?? null,
        startsAt: row.startsAt,
        endsAt: row.endsAt,
        payoutAt: row.payoutAt ?? null,
        mechanic: row.mechanic,
        eligibleTiers: [...row.eligibleTiers],
        controlTiers: [...row.controlTiers],
        region: row.region ?? null,
        statedBudgetUsd: row.statedBudgetUsd?.toFixed(4) ?? null,
        signature: row.signature,
        methodNote: row.methodNote,
      },
    });
  }
}

function spendValues(rows: readonly SpendEvent[]) {
  return rows.map((row) => ({ ...row }));
}

export async function insertSpendEvents(db: Database, rows: readonly SpendEvent[]): Promise<number> {
  let inserted = 0;
  for (const batch of batches(deduplicateSpendEvents(rows))) {
    const result = await db.insert(spendEvent).values(spendValues(batch)).onConflictDoNothing().returning({ txHash: spendEvent.txHash });
    inserted += result.length;
  }
  return inserted;
}

export async function ingestSpendBatch(db: Database, sourceId: string, rows: readonly SpendEvent[], cursor: Cursor): Promise<number> {
  return db.transaction(async (transaction) => {
    let inserted = 0;
    for (const batch of batches(deduplicateSpendEvents(rows))) {
      const result = await transaction.insert(spendEvent).values(spendValues(batch)).onConflictDoNothing().returning({ txHash: spendEvent.txHash });
      inserted += result.length;
    }
    await transaction.insert(ingestCursor).values({
      sourceId,
      blockNumber: cursor.blockNumber,
      blockHash: cursor.blockHash,
      updatedAt: new Date(),
    }).onConflictDoUpdate({
      target: ingestCursor.sourceId,
      set: { blockNumber: cursor.blockNumber, blockHash: cursor.blockHash, updatedAt: new Date() },
    });
    return inserted;
  });
}

export async function insertTierPeriods(db: Database, rows: readonly TierPeriod[]): Promise<number> {
  let inserted = 0;
  for (const batch of batches(rows)) {
    const result = await db.insert(tierPeriod).values(batch.map((row) => ({ ...row }))).onConflictDoNothing().returning({ account: tierPeriod.cardAccount });
    inserted += result.length;
  }
  return inserted;
}

export async function insertTierEvents(db: Database, rows: readonly TierEvent[]): Promise<number> {
  let inserted = 0;
  for (const batch of batches(rows)) {
    const result = await db.insert(tierEvent).values(batch.map((row) => ({ ...row }))).onConflictDoNothing().returning({ txHash: tierEvent.txHash });
    inserted += result.length;
  }
  return inserted;
}

export async function insertMarketPrices(db: Database, rows: readonly MarketPrice[]): Promise<number> {
  let inserted = 0;
  for (const batch of batches(rows)) {
    const result = await db.insert(marketPrice).values(batch.map((row) => ({ ...row }))).onConflictDoNothing().returning({ symbol: marketPrice.symbol });
    inserted += result.length;
  }
  return inserted;
}

export async function upsertCampaignResults(db: Database, rows: readonly CampaignResult[]): Promise<void> {
  for (const row of rows) {
    await db.insert(campaignResult).values({ ...row }).onConflictDoUpdate({
      target: [campaignResult.campaignId, campaignResult.metric],
      set: { value: row.value, ciLow: row.ciLow, ciHigh: row.ciHigh, provenance: row.provenance, methodNote: row.methodNote, computedAt: row.computedAt },
    });
  }
}

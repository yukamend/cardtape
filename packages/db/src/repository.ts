import { and, eq, gt, lte, sql } from 'drizzle-orm';
import type { Campaign, CampaignResult, Cursor, MarketPrice, SpendEvent, TierEvent, TierPeriod } from '../../core/src/types';
import type { Database } from './client';
import { campaign, campaignResult, ingestCursor, marketPrice, spendEvent, tierEvent, tierPeriod } from './schema';
import { SPEND_EVENT_CHANNEL, spendEventNotification } from './tape';

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
    const insertedEvents: SpendEvent[] = [];
    for (const batch of batches(deduplicateSpendEvents(rows))) {
      const result = await transaction.insert(spendEvent).values(spendValues(batch)).onConflictDoNothing().returning({
        chainId: spendEvent.chainId,
        txHash: spendEvent.txHash,
        logIndex: spendEvent.logIndex,
      });
      const insertedKeys = new Set(result.map((row) => `${row.chainId}:${row.txHash}:${row.logIndex}`));
      insertedEvents.push(...batch.filter((row) => insertedKeys.has(spendEventKey(row))));
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
    if (insertedEvents.length > 0) {
      const payloads = JSON.stringify(insertedEvents.map(spendEventNotification));
      await transaction.execute(sql`
        SELECT pg_notify(${SPEND_EVENT_CHANNEL}, payload.value::text)
        FROM jsonb_array_elements(${payloads}::jsonb) AS payload(value)
      `);
    }
    return inserted;
  });
}

export interface ChainIngestResult {
  spendEvents: number;
  tierEvents: number;
}

export async function getIngestCursor(db: Database, sourceId: string): Promise<Cursor | null> {
  const [row] = await db.select({ blockNumber: ingestCursor.blockNumber, blockHash: ingestCursor.blockHash }).from(ingestCursor).where(eq(ingestCursor.sourceId, sourceId)).limit(1);
  if (!row) return null;
  return { blockNumber: row.blockNumber, blockHash: row.blockHash as `0x${string}` | null };
}

export async function ingestChainBatch(
  db: Database,
  sourceId: string,
  spendRows: readonly SpendEvent[],
  tierRows: readonly TierEvent[],
  cursor: Cursor,
): Promise<ChainIngestResult> {
  return db.transaction(async (transaction) => {
    let insertedSpend = 0;
    let insertedTier = 0;
    const insertedEvents: SpendEvent[] = [];

    for (const batch of batches(deduplicateSpendEvents(spendRows))) {
      const result = await transaction.insert(spendEvent).values(spendValues(batch)).onConflictDoNothing().returning({
        chainId: spendEvent.chainId,
        txHash: spendEvent.txHash,
        logIndex: spendEvent.logIndex,
      });
      const insertedKeys = new Set(result.map((row) => `${row.chainId}:${row.txHash}:${row.logIndex}`));
      insertedEvents.push(...batch.filter((row) => insertedKeys.has(spendEventKey(row))));
      insertedSpend += result.length;
    }

    for (const batch of batches(tierRows)) {
      const result = await transaction.insert(tierEvent).values(batch.map((row) => ({ ...row }))).onConflictDoNothing().returning({ txHash: tierEvent.txHash });
      insertedTier += result.length;
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

    if (insertedEvents.length > 0) {
      const payloads = JSON.stringify(insertedEvents.map(spendEventNotification));
      await transaction.execute(sql`
        SELECT pg_notify(${SPEND_EVENT_CHANNEL}, payload.value::text)
        FROM jsonb_array_elements(${payloads}::jsonb) AS payload(value)
      `);
    }

    return { spendEvents: insertedSpend, tierEvents: insertedTier };
  });
}

export async function rewindChainSource(db: Database, sourceId: string, cursor: Cursor): Promise<ChainIngestResult> {
  return db.transaction(async (transaction) => {
    const spendRows = await transaction.delete(spendEvent).where(and(eq(spendEvent.sourceId, sourceId), gt(spendEvent.blockNumber, cursor.blockNumber))).returning({ txHash: spendEvent.txHash });
    const tierRows = await transaction.delete(tierEvent).where(and(eq(tierEvent.sourceId, sourceId), gt(tierEvent.blockNumber, cursor.blockNumber))).returning({ txHash: tierEvent.txHash });
    await transaction.insert(ingestCursor).values({
      sourceId,
      blockNumber: cursor.blockNumber,
      blockHash: cursor.blockHash,
      updatedAt: new Date(),
    }).onConflictDoUpdate({
      target: ingestCursor.sourceId,
      set: { blockNumber: cursor.blockNumber, blockHash: cursor.blockHash, updatedAt: new Date() },
    });
    return { spendEvents: spendRows.length, tierEvents: tierRows.length };
  });
}

export async function finalizeChainSource(db: Database, sourceId: string, finalizedThrough: number): Promise<ChainIngestResult> {
  return db.transaction(async (transaction) => {
    const spendRows = await transaction.update(spendEvent).set({ finalized: true }).where(and(eq(spendEvent.sourceId, sourceId), eq(spendEvent.finalized, false), lte(spendEvent.blockNumber, finalizedThrough))).returning({ txHash: spendEvent.txHash });
    const tierRows = await transaction.update(tierEvent).set({ finalized: true }).where(and(eq(tierEvent.sourceId, sourceId), eq(tierEvent.finalized, false), lte(tierEvent.blockNumber, finalizedThrough))).returning({ txHash: tierEvent.txHash });
    return { spendEvents: spendRows.length, tierEvents: tierRows.length };
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

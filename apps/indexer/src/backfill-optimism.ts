import 'dotenv/config';
import { setTimeout as delay } from 'node:timers/promises';
import { OptimismSource, OPTIMISM_SOURCE_ID } from '../../../packages/adapters/src/optimism';
import type { Cursor } from '../../../packages/core/src/types';
import { createDatabase, requireDatabaseUrl } from '../../../packages/db/src/client';
import { getIngestCursor, insertChainFacts } from '../../../packages/db/src/repository';

interface BackfillReport {
  sourceId: string;
  fromBlock: number;
  throughBlock: number;
  scannedBlocks: number;
  fetched: { spendEvents: number; tierEvents: number };
  inserted: { spendEvents: number; tierEvents: number };
  liveCursorBefore: number | null;
  liveCursorAfter: number | null;
}

function argument(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index === -1 ? undefined : process.argv[index + 1];
}

function blockArgument(name: string, required = true): number | undefined {
  const value = argument(name);
  if (value === undefined && !required) return undefined;
  if (value === undefined) throw new Error(`${name} is required`);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) throw new Error(`${name} must be a positive block number`);
  return parsed;
}

function positiveInteger(value: string | undefined, fallback: number, name: string): number {
  const parsed = value === undefined ? fallback : Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) throw new Error(`${name} must be a positive integer`);
  return parsed;
}

function isTransient(error: unknown): boolean {
  return /RpcRequestError|HTTP request failed|timeout|timed out|rate limit|requests per second|backend|capacity|network|fetch failed|ECONNRESET|ETIMEDOUT|HTTP 429|HTTP 5\d\d/i.test(String(error));
}

async function retryRpc<T>(label: string, operation: () => Promise<T>): Promise<T> {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      if (!isTransient(error) || attempt === 7) throw error;
      const waitMs = Math.min(30_000, 1_000 * 2 ** attempt);
      process.stderr.write(`${label} failed; retrying in ${waitMs}ms.\n`);
      await delay(waitMs);
    }
  }
  throw new Error(`${label} exhausted retries`);
}

export async function backfillOptimism(fromBlock: number, throughBlock: number): Promise<BackfillReport> {
  if (throughBlock < fromBlock) throw new Error('--through-block must not precede --from-block');
  const confirmations = positiveInteger(process.env.OPTIMISM_CONFIRMATIONS, 20, 'OPTIMISM_CONFIRMATIONS');
  const requestedBatchBlocks = positiveInteger(
    argument('--batch-blocks') ?? process.env.OPTIMISM_BACKFILL_BATCH_BLOCKS,
    250,
    '--batch-blocks',
  );
  const source = new OptimismSource({
    rpcUrl: process.env.OPTIMISM_RPC_URL?.trim() || 'https://mainnet.optimism.io',
    confirmations,
  });
  const head = await retryRpc('Head lookup', () => source.getHead());
  if (throughBlock > head - confirmations) throw new Error(`Backfill must end at or before finalized block ${head - confirmations}`);
  const { db, pool } = createDatabase(requireDatabaseUrl());
  try {
    const cursorBefore = await getIngestCursor(db, OPTIMISM_SOURCE_ID);
    let cursor: Cursor = {
      blockNumber: fromBlock - 1,
      blockHash: await retryRpc('Starting block lookup', () => source.getBlockHash(fromBlock - 1)),
    };
    let batchBlocks = requestedBatchBlocks;
    let fetchedSpend = 0;
    let fetchedTier = 0;
    let insertedSpend = 0;
    let insertedTier = 0;

    while (cursor.blockNumber < throughBlock) {
      const remaining = throughBlock - cursor.blockNumber;
      const size = Math.min(batchBlocks, remaining);
      let batch;
      try {
        batch = await retryRpc(`Backfill ${cursor.blockNumber + 1}-${cursor.blockNumber + size}`, () => source.fetch(cursor, size));
      } catch (error) {
        if (size <= 25 || !/response too large|limit|range/i.test(String(error))) throw error;
        batchBlocks = Math.max(25, Math.floor(size / 2));
        process.stderr.write(`Reducing backfill batch to ${batchBlocks} blocks.\n`);
        continue;
      }
      const spendRows = batch.events.flatMap((event) => source.normalize(event));
      const tierRows = batch.events.flatMap((event) => source.normalizeTier(event));
      const inserted = await insertChainFacts(db, spendRows, tierRows);
      fetchedSpend += spendRows.length;
      fetchedTier += tierRows.length;
      insertedSpend += inserted.spendEvents;
      insertedTier += inserted.tierEvents;
      cursor = batch.cursor;
      process.stderr.write(`${JSON.stringify({
        block: cursor.blockNumber,
        throughBlock,
        fetched: { spendEvents: spendRows.length, tierEvents: tierRows.length },
        inserted,
      })}\n`);
      await delay(100);
    }

    const cursorAfter = await getIngestCursor(db, OPTIMISM_SOURCE_ID);
    return {
      sourceId: OPTIMISM_SOURCE_ID,
      fromBlock,
      throughBlock,
      scannedBlocks: throughBlock - fromBlock + 1,
      fetched: { spendEvents: fetchedSpend, tierEvents: fetchedTier },
      inserted: { spendEvents: insertedSpend, tierEvents: insertedTier },
      liveCursorBefore: cursorBefore?.blockNumber ?? null,
      liveCursorAfter: cursorAfter?.blockNumber ?? null,
    };
  } finally {
    await pool.end();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const report = await backfillOptimism(
    blockArgument('--from-block') as number,
    blockArgument('--through-block') as number,
  );
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}

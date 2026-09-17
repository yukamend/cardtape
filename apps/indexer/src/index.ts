import 'dotenv/config';
import { setTimeout as delay } from 'node:timers/promises';
import { OptimismSource } from '../../../packages/adapters/src/optimism';
import type { Cursor } from '../../../packages/core/src/types';
import { createDatabase, requireDatabaseUrl } from '../../../packages/db/src/client';
import {
  finalizeChainSource,
  getIngestCursor,
  ingestChainBatch,
  rewindChainSource,
} from '../../../packages/db/src/repository';

interface IndexerConfig {
  rpcUrl: string;
  confirmations: number;
  batchBlocks: number;
  initialLookbackBlocks: number;
  pollMs: number;
  reorgDepth: number;
  startBlock?: number;
  replayBlocks: number;
  once: boolean;
}

function positiveInteger(value: string | undefined, fallback: number, name: string): number {
  const parsed = value === undefined ? fallback : Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) throw new Error(`${name} must be a positive integer`);
  return parsed;
}

function optionalBlock(value: string | undefined, name: string): number | undefined {
  if (value === undefined || value.trim() === '') return undefined;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) throw new Error(`${name} must be a non-negative block number`);
  return parsed;
}

function argument(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index === -1 ? undefined : process.argv[index + 1];
}

function config(environment: NodeJS.ProcessEnv = process.env): IndexerConfig {
  return {
    rpcUrl: environment.OPTIMISM_RPC_URL?.trim() || 'https://mainnet.optimism.io',
    confirmations: positiveInteger(environment.OPTIMISM_CONFIRMATIONS, 20, 'OPTIMISM_CONFIRMATIONS'),
    batchBlocks: positiveInteger(environment.OPTIMISM_BATCH_BLOCKS, 25, 'OPTIMISM_BATCH_BLOCKS'),
    initialLookbackBlocks: positiveInteger(environment.OPTIMISM_INITIAL_LOOKBACK_BLOCKS, 25, 'OPTIMISM_INITIAL_LOOKBACK_BLOCKS'),
    pollMs: positiveInteger(environment.OPTIMISM_POLL_MS, 2_000, 'OPTIMISM_POLL_MS'),
    reorgDepth: positiveInteger(environment.OPTIMISM_REORG_DEPTH, 64, 'OPTIMISM_REORG_DEPTH'),
    startBlock: optionalBlock(argument('--from-block') ?? environment.OPTIMISM_START_BLOCK, 'OPTIMISM_START_BLOCK'),
    replayBlocks: optionalBlock(argument('--replay-blocks'), '--replay-blocks') ?? 0,
    once: process.argv.includes('--once'),
  };
}

async function canonicalCursor(source: OptimismSource, cursor: Cursor): Promise<boolean> {
  if (!cursor.blockHash) return false;
  return (await source.getBlockHash(cursor.blockNumber)).toLowerCase() === cursor.blockHash.toLowerCase();
}

async function main(): Promise<void> {
  const settings = config();
  const source = new OptimismSource({ rpcUrl: settings.rpcUrl, confirmations: settings.confirmations });
  const database = createDatabase(requireDatabaseUrl());
  const abort = new AbortController();
  const stop = () => abort.abort();
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);

  try {
    let cursor = await getIngestCursor(database.db, source.id);
    if (!cursor) {
      cursor = await source.initialCursor(settings.initialLookbackBlocks, settings.startBlock);
      process.stdout.write(`Initialized ${source.id} at block ${cursor.blockNumber}.\n`);
    } else if (!(await canonicalCursor(source, cursor))) {
      const rewindBlock = Math.max(0, cursor.blockNumber - settings.reorgDepth);
      const rewindCursor = { blockNumber: rewindBlock, blockHash: await source.getBlockHash(rewindBlock) } satisfies Cursor;
      const removed = await rewindChainSource(database.db, source.id, rewindCursor);
      process.stdout.write(`Reorg detected at ${cursor.blockNumber}; rewound to ${rewindBlock} and removed ${removed.spendEvents} spend / ${removed.tierEvents} tier rows.\n`);
      cursor = rewindCursor;
    }

    if (settings.replayBlocks > 0) {
      const replayBlock = Math.max(0, cursor.blockNumber - settings.replayBlocks);
      cursor = { blockNumber: replayBlock, blockHash: await source.getBlockHash(replayBlock) };
      process.stdout.write(`Replaying ${settings.replayBlocks} blocks from ${replayBlock + 1}; immutable rows must remain unchanged.\n`);
    }

    while (!abort.signal.aborted) {
      const startedAt = Date.now();
      const fetchBlocks = settings.replayBlocks > 0 ? Math.max(settings.batchBlocks, settings.replayBlocks) : settings.batchBlocks;
      const batch = await source.fetch(cursor, fetchBlocks);
      const spendEvents = batch.events.flatMap((event) => source.normalize(event));
      const tierEvents = batch.events.flatMap((event) => source.normalizeTier(event));
      const inserted = await ingestChainBatch(database.db, source.id, spendEvents, tierEvents, batch.cursor);
      const finalized = settings.replayBlocks > 0
        ? { spendEvents: 0, tierEvents: 0 }
        : await finalizeChainSource(database.db, source.id, batch.head - settings.confirmations);
      cursor = batch.cursor;
      process.stdout.write(`${JSON.stringify({
        source: source.id,
        block: cursor.blockNumber,
        head: batch.head,
        fetched: { spend: spendEvents.length, tier: tierEvents.length },
        inserted,
        finalized,
        elapsedMs: Date.now() - startedAt,
      })}\n`);

      if (settings.once) break;
      if (cursor.blockNumber >= batch.head) await delay(settings.pollMs, undefined, { signal: abort.signal }).catch(() => undefined);
    }
  } finally {
    process.removeListener('SIGINT', stop);
    process.removeListener('SIGTERM', stop);
    await database.pool.end();
  }
}

await main();

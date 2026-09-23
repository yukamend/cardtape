import 'dotenv/config';
import { setTimeout as delay } from 'node:timers/promises';
import { OptimismSource } from '../../../packages/adapters/src/optimism';
import { getPlasmaImpact } from '../../../packages/adapters/src/plasma';
import { campaigns } from '../../../packages/core/src/campaigns';
import type { CampaignImpact } from '../../../packages/core/src/neobanks';
import type { PublishedSnapshot } from '../../../packages/core/src/published-snapshot';
import { rollingCashImpact } from '../../../packages/core/src/rolling-cash';
import { classifyTapeEvent, TAPE_RING_CAPACITY, tapeEventId } from '../../../packages/core/src/tape';
import type { SpendEvent } from '../../../packages/core/src/types';
import {
  readSnapshotState, writeSnapshotState, writePublishedSnapshot,
  type RecentSpend, type SnapshotState,
} from './snapshot-state';

const DAY = 86_400_000;
const SPEND_RETENTION_MS = 50 * 60 * 60_000;

function positiveInteger(value: string | undefined, fallback: number, name: string): number {
  const parsed = value === undefined ? fallback : Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) throw new Error(`${name} must be a positive integer`);
  return parsed;
}

async function fetchBatch(source: OptimismSource, cursor: SnapshotState['cursor'], requested: number) {
  let size = requested;
  for (let attempt = 0; attempt < 8; attempt += 1) {
    try {
      return await source.fetch(cursor, size);
    } catch (error) {
      const message = String(error);
      if (/response too large|block range|limit exceeded|too many results/i.test(message) && size > 25) {
        size = Math.max(25, Math.floor(size / 2));
      } else if (!/RpcRequestError|HTTP request failed|timeout|rate limit|network|fetch failed|ECONNRESET|ETIMEDOUT|HTTP 429|HTTP 5\d\d/i.test(message) || attempt === 7) {
        throw error;
      }
      await delay(Math.min(15_000, 500 * 2 ** attempt));
    }
  }
  throw new Error('Optimism snapshot scan exhausted retries');
}

function recentSpend(event: SpendEvent): RecentSpend | null {
  if (event.eventType !== 'spend' || event.amountUsd === null || !event.finalized) return null;
  return {
    id: tapeEventId(event), blockNumber: event.blockNumber,
    blockTime: event.blockTime.toISOString(), cardAccount: event.cardAccount, amountUsd: event.amountUsd,
  };
}

function includeBatch(state: SnapshotState, events: readonly SpendEvent[], cutoff: number): void {
  const spends = new Map(state.recentSpends.map((row) => [row.id, row]));
  const tape = new Map(state.tape.map((row) => [row.id, row]));
  for (const event of events) {
    if (!event.finalized || event.provenance !== 'measured') continue;
    const spend = recentSpend(event);
    if (spend && Date.parse(spend.blockTime) >= cutoff) spends.set(spend.id, spend);
    tape.set(tapeEventId(event), classifyTapeEvent(event, null, campaigns));
  }
  state.recentSpends = [...spends.values()].filter((row) => Date.parse(row.blockTime) >= cutoff);
  state.tape = [...tape.values()]
    .sort((left, right) => right.blockNumber - left.blockNumber || right.logIndex - left.logIndex)
    .slice(0, TAPE_RING_CAPACITY);
}

async function catchUp(state: SnapshotState): Promise<void> {
  const source = new OptimismSource({
    rpcUrl: process.env.OPTIMISM_RPC_URL?.trim() || 'https://mainnet.optimism.io',
    confirmations: positiveInteger(process.env.OPTIMISM_CONFIRMATIONS, 20, 'OPTIMISM_CONFIRMATIONS'),
  });
  const actualHash = await source.getBlockHash(state.cursor.blockNumber);
  if (actualHash.toLowerCase() !== state.cursor.blockHash.toLowerCase()) {
    throw new Error('Optimism checkpoint block hash changed. Re-bootstrap from the local archive before publishing.');
  }
  const head = await source.getHead();
  const target = head - source.confirmations;
  if (target < state.cursor.blockNumber) throw new Error('Optimism RPC head is behind the saved checkpoint.');
  const configuredBatch = positiveInteger(process.env.OPTIMISM_SNAPSHOT_BATCH_BLOCKS, 1_000, 'OPTIMISM_SNAPSHOT_BATCH_BLOCKS');
  let batches = 0;
  while (state.cursor.blockNumber < target) {
    const limit = Math.min(configuredBatch, target - state.cursor.blockNumber);
    const batch = await fetchBatch(source, state.cursor, limit);
    if (!batch.cursor.blockHash) throw new Error('Optimism batch returned a cursor without a block hash.');
    const events = batch.events.flatMap((event) => source.normalize(event));
    includeBatch(state, events, Date.now() - SPEND_RETENTION_MS);
    state.cursor = { blockNumber: batch.cursor.blockNumber, blockHash: batch.cursor.blockHash, indexedAt: new Date().toISOString() };
    batches += 1;
    if (batches % 10 === 0) {
      await writeSnapshotState(state);
      process.stdout.write(`Scanned Optimism through block ${state.cursor.blockNumber}/${target}.\n`);
    }
  }
  state.recentSpends = state.recentSpends.filter((row) => Date.parse(row.blockTime) >= Date.now() - SPEND_RETENTION_MS);
  state.cursor.indexedAt = new Date().toISOString();
  await writeSnapshotState(state);
  const freshHead = await source.getHead();
  if (freshHead - state.cursor.blockNumber > 1_800) {
    throw new Error('Optimism checkpoint is still over one hour behind. Run snapshot:generate again to continue catch-up.');
  }
  process.stdout.write(`Optimism checkpoint: block ${state.cursor.blockNumber} (${batches} batches).\n`);
}

function publishedImpact(impact: CampaignImpact): CampaignImpact {
  return {
    ...impact,
    metrics: impact.metrics.map((metric) => ({
      ...metric,
      evidence: {
        ...metric.evidence,
        kind: metric.evidence.kind === 'live' ? 'cached' : metric.evidence.kind,
        note: `${metric.evidence.note} Published from an onchain snapshot; values update when a new snapshot is deployed.`,
      },
    })),
  };
}

export async function updateSnapshot(): Promise<PublishedSnapshot> {
  const state = await readSnapshotState();
  await catchUp(state);
  const asOf = new Date();
  const campaignResults: PublishedSnapshot['campaigns'] = {
    ...state.fixedCampaigns,
    'etherfi-cash-live': { '1': rollingCashImpact(state.recentSpends, asOf) },
    'plasma-one-platinum-locks': {},
  };
  for (const baselineDays of [7, 14, 30]) {
    const start = asOf.getTime() - 7 * DAY;
    const impact = await getPlasmaImpact({
      neobankId: 'plasma-one', campaignId: 'plasma-one-platinum-locks',
      campaignPeriod: { start: new Date(start).toISOString(), end: asOf.toISOString() },
      baselinePeriod: { start: new Date(start - baselineDays * DAY).toISOString(), end: new Date(start - 1).toISOString() },
    });
    campaignResults['plasma-one-platinum-locks']![String(baselineDays)] = publishedImpact(impact);
    process.stdout.write(`Snapshotted Plasma with ${baselineDays}-day baseline.\n`);
  }
  const snapshot: PublishedSnapshot = {
    version: 1, generatedAt: new Date().toISOString(),
    optimism: {
      blockNumber: state.cursor.blockNumber, indexedAt: state.cursor.indexedAt,
      tierBlockNumber: state.tierBlockNumber, tiersIndexedAt: state.tiersIndexedAt,
    },
    tape: state.tape,
    campaigns: campaignResults,
  };
  await writePublishedSnapshot(snapshot);
  return snapshot;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const snapshot = await updateSnapshot();
  process.stdout.write(`Wrote database-free snapshot at Optimism block ${snapshot.optimism.blockNumber}.\n`);
}

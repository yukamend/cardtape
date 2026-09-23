import 'dotenv/config';
import { access } from 'node:fs/promises';
import { createPublicClient, http } from 'viem';
import { optimism } from 'viem/chains';
import { readPublishedSnapshot, SNAPSHOT_STATE_PATH, writeSnapshotState, type SnapshotState } from './snapshot-state';

const RETENTION_MS = 50 * 60 * 60_000;

async function main(): Promise<void> {
  try {
    await access(SNAPSHOT_STATE_PATH);
    throw new Error('A snapshot checkpoint already exists. Keep it; it contains the newest incremental cursor.');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  const published = await readPublishedSnapshot();
  const client = createPublicClient({
    chain: optimism,
    transport: http(process.env.OPTIMISM_RPC_URL?.trim() || 'https://mainnet.optimism.io', { retryCount: 3, timeout: 15_000 }),
  });
  const head = await client.getBlockNumber();
  const cutoff = Date.now() - RETENTION_MS;
  let low = 0n;
  let high = head;
  while (low < high) {
    const middle = (low + high) / 2n;
    const block = await client.getBlock({ blockNumber: middle, includeTransactions: false });
    if (Number(block.timestamp) * 1_000 < cutoff) low = middle + 1n;
    else high = middle;
  }
  if (low === 0n) throw new Error('Optimism history does not cover the required 50-hour window.');
  const block = await client.getBlock({ blockNumber: low - 1n, includeTransactions: false });
  const state: SnapshotState = {
    version: 1,
    cursor: { blockNumber: Number(block.number), blockHash: block.hash, indexedAt: new Date(Number(block.timestamp) * 1_000).toISOString() },
    tierBlockNumber: published.optimism.tierBlockNumber,
    tiersIndexedAt: published.optimism.tiersIndexedAt,
    recentSpends: [], tape: [],
    fixedCampaigns: Object.fromEntries(Object.entries(published.campaigns)
      .filter(([id]) => id !== 'etherfi-cash-live' && id !== 'plasma-one-platinum-locks')),
  };
  await writeSnapshotState(state);
  process.stdout.write(`Initialized the database-free checkpoint at Optimism block ${state.cursor.blockNumber}. Run npm run snapshot:generate to scan the last 50 hours.\n`);
}

if (import.meta.url === `file://${process.argv[1]}`) await main();

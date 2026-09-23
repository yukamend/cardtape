import 'dotenv/config';
import { campaigns, PROGRAM_ID } from '../../../packages/core/src/campaigns';
import { classifyTapeEvent, TAPE_RING_CAPACITY } from '../../../packages/core/src/tape';
import { OptimismSource, OPTIMISM_SOURCE_ID } from '../../../packages/adapters/src/optimism';
import { createDatabase, requireDatabaseUrl } from '../../../packages/db/src/client';
import { loadTapeSnapshot } from '../../../packages/db/src/tape';
import { readPublishedSnapshot, writeSnapshotState, type RecentSpend, type SnapshotState } from './snapshot-state';

interface SpendRow {
  chain_id: number;
  tx_hash: `0x${string}`;
  log_index: number;
  block_number: string;
  block_time: Date;
  card_account: `0x${string}`;
  amount_usd: string;
}

async function main(): Promise<void> {
  const published = await readPublishedSnapshot();
  const { pool } = createDatabase(requireDatabaseUrl());
  try {
    const cursorResult = await pool.query<{ block_number: string; block_hash: `0x${string}`; updated_at: Date }>(
      'SELECT block_number, block_hash, updated_at FROM ingest_cursor WHERE source_id = $1', [OPTIMISM_SOURCE_ID],
    );
    const cursor = cursorResult.rows[0];
    if (!cursor?.block_hash) throw new Error('Optimism cursor is missing a block hash.');
    const confirmations = Number(process.env.OPTIMISM_CONFIRMATIONS ?? '20');
    if (!Number.isSafeInteger(confirmations) || confirmations < 1) throw new Error('OPTIMISM_CONFIRMATIONS must be a positive integer.');
    const source = new OptimismSource({ rpcUrl: process.env.OPTIMISM_RPC_URL?.trim() || 'https://mainnet.optimism.io', confirmations });
    const finalizedHead = (await source.getHead()) - confirmations;
    const throughBlock = Math.min(Number(cursor.block_number), finalizedHead);
    const blockHash = throughBlock === Number(cursor.block_number) ? cursor.block_hash : await source.getBlockHash(throughBlock);
    const spendResult = await pool.query<SpendRow>(`
      SELECT chain_id, tx_hash, log_index, block_number, block_time, card_account, amount_usd
      FROM spend_event
      WHERE source_id = $1 AND provenance = 'measured' AND finalized = true AND event_type = 'spend'
        AND amount_usd IS NOT NULL AND block_time >= $2 AND block_number <= $3
      ORDER BY block_number, log_index
    `, [OPTIMISM_SOURCE_ID, new Date(Date.now() - 50 * 60 * 60_000), throughBlock]);
    if (spendResult.rows.length === 0) throw new Error('No recent finalized measured spends are available.');
    const recentSpends: RecentSpend[] = spendResult.rows.map((row) => ({
      id: `${row.chain_id}:${row.tx_hash}:${row.log_index}`,
      blockNumber: Number(row.block_number), blockTime: row.block_time.toISOString(),
      cardAccount: row.card_account, amountUsd: row.amount_usd,
    }));
    const tapeRows = await loadTapeSnapshot(pool, PROGRAM_ID, new Date(), TAPE_RING_CAPACITY, 'measured', true);
    const tierBlockNumber = published.optimism.tierBlockNumber;
    const state: SnapshotState = {
      version: 1,
      cursor: { blockNumber: throughBlock, blockHash, indexedAt: cursor.updated_at.toISOString() },
      tierBlockNumber,
      tiersIndexedAt: published.optimism.tiersIndexedAt,
      recentSpends,
      tape: tapeRows.map(({ event, tier }) => classifyTapeEvent(
        event, tierBlockNumber !== null && event.blockNumber <= tierBlockNumber ? tier : null, campaigns,
      )),
      fixedCampaigns: Object.fromEntries(Object.entries(published.campaigns)
        .filter(([id]) => id !== 'etherfi-cash-live' && id !== 'plasma-one-platinum-locks')),
    };
    await writeSnapshotState(state);
    process.stdout.write(`Created compressed checkpoint with ${recentSpends.length} recent spends and ${state.tape.length} tape events. Future snapshots need no PostgreSQL.\n`);
  } finally {
    await pool.end();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) await main();

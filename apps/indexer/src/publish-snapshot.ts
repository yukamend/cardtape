import 'dotenv/config';
import { mkdir, rename, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import type { Pool } from 'pg';
import { campaigns, PROGRAM_ID } from '../../../packages/core/src/campaigns';
import { classifyTapeEvent, TAPE_RING_CAPACITY } from '../../../packages/core/src/tape';
import { neobankCampaigns, type CampaignImpact } from '../../../packages/core/src/neobanks';
import type { PublishedSnapshot } from '../../../packages/core/src/published-snapshot';
import { OPTIMISM_SOURCE_ID } from '../../../packages/adapters/src/optimism';
import { TIER_PERIOD_SOURCE_ID } from './reconstruct-tiers';
import { getPlasmaImpact } from '../../../packages/adapters/src/plasma';
import { createDatabase, requireDatabaseUrl } from '../../../packages/db/src/client';
import { loadEtherfiImpact } from '../../../packages/db/src/campaign-impact';
import { loadTapeSnapshot } from '../../../packages/db/src/tape';

const DAY = 86_400_000;
const MAX_CURSOR_AGE_MS = 60 * 60_000;

function windowFrom(start: number, end: number) {
  return { start: new Date(start).toISOString(), end: new Date(end).toISOString() };
}

function publishedImpact(impact: CampaignImpact): CampaignImpact {
  return {
    ...impact,
    metrics: impact.metrics.map((metric) => ({
      ...metric,
      evidence: {
        ...metric.evidence,
        kind: metric.evidence.kind === 'live' ? 'cached' : metric.evidence.kind,
        note: `${metric.evidence.note} Published from a local onchain snapshot; values update when a new snapshot is deployed.`,
      },
    })),
  };
}

export async function buildPublishedSnapshot(pool: Pool, now = new Date(), allowStale = false): Promise<PublishedSnapshot> {
  const cursorResult = await pool.query<{ source_id: string; block_number: string; updated_at: Date }>(
    'SELECT source_id, block_number, updated_at FROM ingest_cursor WHERE source_id IN ($1, $2)', [OPTIMISM_SOURCE_ID, TIER_PERIOD_SOURCE_ID],
  );
  const cursor = cursorResult.rows.find((row) => row.source_id === OPTIMISM_SOURCE_ID);
  const tierCursor = cursorResult.rows.find((row) => row.source_id === TIER_PERIOD_SOURCE_ID);
  if (!cursor) throw new Error('Optimism cursor is missing. Run the local indexer first.');
  const indexedAt = new Date(cursor.updated_at);
  if (!Number.isFinite(indexedAt.getTime())) throw new Error('Optimism cursor timestamp is invalid.');
  if (!allowStale && now.getTime() - indexedAt.getTime() > MAX_CURSOR_AGE_MS) {
    throw new Error('Optimism indexer is over one hour behind. Run npm run indexer:catchup, or use --allow-stale.');
  }

  const tapeRows = await loadTapeSnapshot(pool, PROGRAM_ID, now, TAPE_RING_CAPACITY, 'measured', true);
  if (tapeRows.length === 0) throw new Error('No finalized measured tape events are available.');
  const tierBlockNumber = tierCursor ? Number(tierCursor.block_number) : null;
  const tape = tapeRows.map(({ event, tier }) => classifyTapeEvent(
    event,
    tierBlockNumber !== null && event.blockNumber <= tierBlockNumber ? tier : null,
    campaigns,
  ));
  const campaignResults: PublishedSnapshot['campaigns'] = {};

  for (const campaign of neobankCampaigns) {
    if (campaign.status === 'unavailable' || campaign.status === 'demonstration') continue;
    const baselineOptions = campaign.id === 'etherfi-cash-live' ? [1] : [7, 14, 30];
    campaignResults[campaign.id] = {};
    for (const baselineDays of baselineOptions) {
      const rolling = campaign.id === 'etherfi-cash-live' || campaign.neobankId === 'plasma-one';
      const campaignStart = rolling
        ? now.getTime() - (campaign.id === 'etherfi-cash-live' ? DAY : 7 * DAY)
        : Date.parse(campaign.startsAt);
      const campaignEnd = rolling ? now.getTime() : Date.parse(campaign.endsAt);
      const campaignPeriod = windowFrom(campaignStart, campaignEnd);
      const baselinePeriod = windowFrom(campaignStart - baselineDays * DAY, campaignStart - 1);
      const impact = campaign.neobankId === 'plasma-one'
        ? await getPlasmaImpact({ neobankId: campaign.neobankId, campaignId: campaign.id, campaignPeriod, baselinePeriod })
        : await loadEtherfiImpact(pool, campaign.id, campaignPeriod, baselinePeriod);
      campaignResults[campaign.id][String(baselineDays)] = publishedImpact(impact);
      process.stdout.write(`Snapshotted ${campaign.id} with ${baselineDays}-day baseline.\n`);
    }
  }

  return {
    version: 1,
    generatedAt: new Date().toISOString(),
    optimism: {
      blockNumber: Number(cursor.block_number), indexedAt: indexedAt.toISOString(),
      tierBlockNumber, tiersIndexedAt: tierCursor ? new Date(tierCursor.updated_at).toISOString() : null,
    },
    tape,
    campaigns: campaignResults,
  };
}

async function main(): Promise<void> {
  const { pool } = createDatabase(requireDatabaseUrl());
  try {
    const snapshot = await buildPublishedSnapshot(pool, new Date(), process.argv.includes('--allow-stale'));
    const path = resolve('public/snapshots/current.json');
    const temporaryPath = `${path}.${process.pid}.tmp`;
    await mkdir(dirname(path), { recursive: true });
    await writeFile(temporaryPath, `${JSON.stringify(snapshot)}\n`);
    await rename(temporaryPath, path);
    process.stdout.write(`Published ${snapshot.tape.length} finalized events to ${path}.\n`);
  } finally {
    await pool.end();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) await main();

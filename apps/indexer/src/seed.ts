import 'dotenv/config';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { campaigns } from '../../../packages/core/src/campaigns';
import { estimateAllCampaigns } from '../../../packages/core/src/estimators/pipeline';
import { generateSyntheticDataset, fingerprintSyntheticDataset } from '../../../packages/adapters/src/synthetic';
import { createDatabase, requireDatabaseUrl } from '../../../packages/db/src/client';
import {
  insertMarketPrices,
  insertSpendEvents,
  insertTierEvents,
  insertTierPeriods,
  upsertCampaignRegistry,
  upsertCampaignResults,
} from '../../../packages/db/src/repository';

export interface SeedSummary {
  fingerprint: string;
  spendEvents: number;
  tierPeriods: number;
  tierEvents: number;
  marketPrices: number;
  campaignResults: number;
}

function computedResults(dataset: ReturnType<typeof generateSyntheticDataset>) {
  return [
    ...dataset.campaignResults,
    ...estimateAllCampaigns({
      spendEvents: dataset.spendEvents,
      tierPeriods: dataset.tierPeriods,
      tierEvents: dataset.tierEvents,
      marketPrices: dataset.marketPrices,
      computedAt: dataset.generatedAt,
    }, campaigns),
  ];
}

export function createSeedSummary(seed = 'cardtape-v0.1'): SeedSummary {
  const dataset = generateSyntheticDataset({ seed });
  const results = computedResults(dataset);
  return {
    fingerprint: fingerprintSyntheticDataset(dataset),
    spendEvents: dataset.spendEvents.length,
    tierPeriods: dataset.tierPeriods.length,
    tierEvents: dataset.tierEvents.length,
    marketPrices: dataset.marketPrices.length,
    campaignResults: results.length,
  };
}

export async function seedDatabase(seed = 'cardtape-v0.1'): Promise<SeedSummary> {
  const dataset = generateSyntheticDataset({ seed });
  const results = computedResults(dataset);
  const { db, pool } = createDatabase(requireDatabaseUrl());
  try {
    await migrate(db, { migrationsFolder: './packages/db/migrations' });
    await upsertCampaignRegistry(db, campaigns);
    await insertTierPeriods(db, dataset.tierPeriods);
    await insertTierEvents(db, dataset.tierEvents);
    await insertMarketPrices(db, dataset.marketPrices);
    await insertSpendEvents(db, dataset.spendEvents);
    await upsertCampaignResults(db, results);
    return {
      fingerprint: fingerprintSyntheticDataset(dataset),
      spendEvents: dataset.spendEvents.length,
      tierPeriods: dataset.tierPeriods.length,
      tierEvents: dataset.tierEvents.length,
      marketPrices: dataset.marketPrices.length,
      campaignResults: results.length,
    };
  } finally {
    await pool.end();
  }
}

function printSummary(summary: SeedSummary, dryRun: boolean): void {
  process.stdout.write(`${dryRun ? 'Generated' : 'Seeded'} deterministic CARDTAPE fixture ${summary.fingerprint.slice(0, 12)}\n`);
  process.stdout.write(`  spend events:     ${summary.spendEvents}\n`);
  process.stdout.write(`  tier periods:     ${summary.tierPeriods}\n`);
  process.stdout.write(`  tier events:      ${summary.tierEvents}\n`);
  process.stdout.write(`  market prices:    ${summary.marketPrices}\n`);
  process.stdout.write(`  campaign results: ${summary.campaignResults}\n`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const dryRun = process.argv.includes('--dry-run');
  const summary = dryRun ? createSeedSummary() : await seedDatabase();
  printSummary(summary, dryRun);
}

import 'dotenv/config';
import { campaigns } from '../../../packages/core/src/campaigns';
import { estimateAllCampaigns } from '../../../packages/core/src/estimators/pipeline';
import type { MarketPrice, SpendEvent, TierEvent, TierPeriod } from '../../../packages/core/src/types';
import { createDatabase, requireDatabaseUrl } from '../../../packages/db/src/client';
import { upsertCampaignResults } from '../../../packages/db/src/repository';
import { marketPrice, spendEvent, tierEvent, tierPeriod } from '../../../packages/db/src/schema';

export async function recomputeCampaignResults(): Promise<number> {
  const { db, pool } = createDatabase(requireDatabaseUrl());
  try {
    const [spendRows, periodRows, tierRows, priceRows] = await Promise.all([
      db.select().from(spendEvent),
      db.select().from(tierPeriod),
      db.select().from(tierEvent),
      db.select().from(marketPrice),
    ]);
    const results = estimateAllCampaigns({
      spendEvents: spendRows as unknown as SpendEvent[],
      tierPeriods: periodRows as unknown as TierPeriod[],
      tierEvents: tierRows as unknown as TierEvent[],
      marketPrices: priceRows as unknown as MarketPrice[],
      computedAt: new Date(),
    }, campaigns);
    await upsertCampaignResults(db, results);
    return results.length;
  } finally {
    await pool.end();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const count = await recomputeCampaignResults();
  process.stdout.write(`Recomputed ${count} campaign metrics.\n`);
}

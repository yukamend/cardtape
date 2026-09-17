import 'dotenv/config';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { generateSyntheticDataset } from '../packages/adapters/src/synthetic';
import { createDatabase, type Database } from '../packages/db/src/client';
import { insertSpendEvents } from '../packages/db/src/repository';
import { spendEvent } from '../packages/db/src/schema';

const databaseUrl = process.env.DATABASE_URL;
const integration = databaseUrl ? describe : describe.skip;
let database: ReturnType<typeof createDatabase> | null = null;
let db: Database | null = null;

integration('Postgres idempotency', () => {
  beforeAll(async () => {
    if (!databaseUrl) return;
    database = createDatabase(databaseUrl);
    db = database.db;
    await migrate(db, { migrationsFolder: './packages/db/migrations' });
    await db.delete(spendEvent).where(eq(spendEvent.chainId, 9_999));
  });

  afterAll(async () => {
    if (db) await db.delete(spendEvent).where(eq(spendEvent.chainId, 9_999));
    await database?.pool.end();
  });

  it('makes a repeated adapter window a no-op', async () => {
    if (!db) throw new Error('Integration database was not initialized');
    const fixture = generateSyntheticDataset({ seed: 'postgres-idempotency', accountCount: 50 }).spendEvents.slice(0, 25).map((event) => ({ ...event, chainId: 9_999 }));
    const first = await insertSpendEvents(db, fixture);
    const second = await insertSpendEvents(db, fixture);

    expect(first).toBe(25);
    expect(second).toBe(0);
  });
});

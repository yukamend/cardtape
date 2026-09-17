import 'dotenv/config';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { generateSyntheticDataset } from '../packages/adapters/src/synthetic';
import { createDatabase, type Database } from '../packages/db/src/client';
import { ingestSpendBatch, insertSpendEvents } from '../packages/db/src/repository';
import { ingestCursor, spendEvent } from '../packages/db/src/schema';
import { parseSpendEventNotification, SPEND_EVENT_CHANNEL } from '../packages/db/src/tape';

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
    await db.delete(spendEvent).where(eq(spendEvent.chainId, 9_998));
    await db.delete(ingestCursor).where(eq(ingestCursor.sourceId, 'test:tape-notify'));
  });

  afterAll(async () => {
    if (db) await db.delete(spendEvent).where(eq(spendEvent.chainId, 9_999));
    if (db) await db.delete(spendEvent).where(eq(spendEvent.chainId, 9_998));
    if (db) await db.delete(ingestCursor).where(eq(ingestCursor.sourceId, 'test:tape-notify'));
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

  it('publishes each newly committed spend event through Postgres NOTIFY', async () => {
    if (!db || !database) throw new Error('Integration database was not initialized');
    const [fixture] = generateSyntheticDataset({ seed: 'postgres-notify', accountCount: 50 }).spendEvents;
    if (!fixture) throw new Error('Synthetic fixture did not produce a spend event');
    const event = { ...fixture, chainId: 9_998, sourceId: 'test:tape-notify' };
    const listener = await database.pool.connect();
    try {
      await listener.query(`LISTEN ${SPEND_EVENT_CHANNEL}`);
      const notification = new Promise<string>((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('Timed out waiting for spend notification')), 2_000);
        listener.once('notification', (message) => {
          clearTimeout(timeout);
          resolve(message.payload ?? '');
        });
      });
      const inserted = await ingestSpendBatch(db, event.sourceId, [event], {
        blockNumber: event.blockNumber,
        blockHash: null,
      });
      const published = parseSpendEventNotification(await notification);
      expect(inserted).toBe(1);
      expect(published.chainId).toBe(9_998);
      expect(published.txHash).toBe(event.txHash);
    } finally {
      await listener.query(`UNLISTEN ${SPEND_EVENT_CHANNEL}`);
      listener.release();
    }
  });
});

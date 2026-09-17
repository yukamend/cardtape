import 'dotenv/config';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { createDatabase, requireDatabaseUrl } from '../../../packages/db/src/client';

export async function runMigrations(): Promise<void> {
  const { db, pool } = createDatabase(requireDatabaseUrl());
  try {
    await migrate(db, { migrationsFolder: './packages/db/migrations' });
  } finally {
    await pool.end();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await runMigrations();
  process.stdout.write('CARDTAPE database migrations applied.\n');
}

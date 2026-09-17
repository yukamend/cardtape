import 'dotenv/config';
import { createDatabase, requireDatabaseUrl } from '../../../packages/db/src/client';

async function main(): Promise<void> {
  const { db, pool } = createDatabase(requireDatabaseUrl());
  try {
    await db.execute('select 1');
    process.stdout.write('CARDTAPE indexer foundation ready. Live adapters are intentionally deferred to the OP Mainnet phase.\n');
  } finally {
    await pool.end();
  }
}

await main();

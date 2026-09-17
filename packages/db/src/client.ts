import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from './schema';

export function requireDatabaseUrl(environment: NodeJS.ProcessEnv = process.env): string {
  const value = environment.DATABASE_URL?.trim();
  if (!value) throw new Error('DATABASE_URL is required. Copy .env.example to .env and start the local database.');
  return value;
}

export function createDatabase(connectionString: string) {
  const pool = new Pool({ connectionString, max: 10 });
  const db = drizzle({ client: pool, schema });
  return { db, pool };
}

export type Database = ReturnType<typeof createDatabase>['db'];

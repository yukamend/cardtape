import { Pool } from 'pg';
import { requireDatabaseUrl } from './client';

let pool: Pool | undefined;

/** Reuse connections across warm Node.js function invocations. */
export function getServerPool(): Pool {
  pool ??= new Pool({ connectionString: requireDatabaseUrl(), max: 2, idleTimeoutMillis: 30_000 });
  return pool;
}

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const migrationDirectory = join(process.cwd(), 'packages/db/migrations');
const sql = readdirSync(migrationDirectory)
  .filter((file) => file.endsWith('.sql'))
  .sort()
  .map((file) => readFileSync(join(migrationDirectory, file), 'utf8'))
  .join('\n');

describe('database migration invariants', () => {
  it('stores uint256-sized raw amounts and preserves nullable derived USD', () => {
    expect(sql).toMatch(/"amount_raw" numeric\(78, 0\) NOT NULL/);
    expect(sql).toMatch(/"amount_usd" numeric\(20, 4\),/);
  });

  it('enforces idempotent event identities and result provenance', () => {
    expect(sql).toMatch(/PRIMARY KEY\("chain_id","tx_hash","log_index"\)/);
    expect(sql).toMatch(/"provenance" text NOT NULL/);
    expect(sql).toMatch(/campaign_result_provenance_check/);
  });

  it('prevents overlapping retrospective tier intervals', () => {
    expect(sql).toMatch(/tier_period_no_overlap/);
    expect(sql).toMatch(/tstzrange\("valid_from", COALESCE\("valid_to", 'infinity'::timestamptz\), '\[\)'\) WITH &&/);
  });
});

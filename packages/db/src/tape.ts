import type { Pool } from 'pg';
import type { SpendEvent, Tier, TierPeriod } from '../../core/src/types';

export const SPEND_EVENT_CHANNEL = 'cardtape_spend_event';

interface SnapshotRow {
  chain_id: number;
  tx_hash: `0x${string}`;
  log_index: number;
  block_number: string | number;
  block_time: Date;
  event_type: SpendEvent['eventType'];
  program_id: string;
  card_account: `0x${string}`;
  token_symbol: string;
  decimals: number;
  amount_raw: string;
  settlement_ccy: SpendEvent['settlementCcy'];
  amount_usd: string | null;
  price_source: string | null;
  priced_at: Date | null;
  source_id: string;
  provenance: SpendEvent['provenance'];
  finalized: boolean;
  tier: Tier | null;
}

export interface TapeSnapshotRecord {
  event: SpendEvent;
  tier: Tier | null;
}

function rowToRecord(row: SnapshotRow): TapeSnapshotRecord {
  return {
    event: {
      chainId: row.chain_id,
      txHash: row.tx_hash,
      logIndex: row.log_index,
      blockNumber: Number(row.block_number),
      blockTime: row.block_time,
      eventType: row.event_type,
      programId: row.program_id,
      cardAccount: row.card_account,
      tokenSymbol: row.token_symbol,
      decimals: row.decimals,
      amountRaw: row.amount_raw,
      settlementCcy: row.settlement_ccy,
      amountUsd: row.amount_usd,
      priceSource: row.price_source,
      pricedAt: row.priced_at,
      sourceId: row.source_id,
      provenance: row.provenance,
      finalized: row.finalized,
    },
    tier: row.tier,
  };
}

export async function loadTapeSnapshot(
  pool: Pool,
  programId: string,
  asOf: Date,
  limit = 500,
  provenance?: 'measured' | 'demo',
  finalizedOnly = false,
): Promise<TapeSnapshotRecord[]> {
  const result = await pool.query<SnapshotRow>(`
    SELECT
      event.chain_id,
      event.tx_hash,
      event.log_index,
      event.block_number,
      event.block_time,
      event.event_type,
      event.program_id,
      event.card_account,
      event.token_symbol,
      event.decimals,
      event.amount_raw,
      event.settlement_ccy,
      event.amount_usd,
      event.price_source,
      event.priced_at,
      event.source_id,
      event.provenance,
      event.finalized,
      account_tier.tier
    FROM spend_event AS event
    LEFT JOIN LATERAL (
      SELECT period.tier
      FROM tier_period AS period
      WHERE period.program_id = event.program_id
        AND period.card_account = event.card_account
        AND period.provenance = event.provenance
        AND period.valid_from <= event.block_time
        AND (period.valid_to IS NULL OR period.valid_to > event.block_time)
      ORDER BY period.valid_from DESC
      LIMIT 1
    ) AS account_tier ON true
    WHERE event.program_id = $1
      AND event.block_time <= $2
      AND ($4::text IS NULL OR event.provenance = $4)
      AND (NOT $5::boolean OR event.finalized = true)
    ORDER BY event.block_time DESC, event.block_number DESC, event.log_index DESC
    LIMIT $3
  `, [programId, asOf, limit, provenance ?? null, finalizedOnly]);
  return result.rows.map(rowToRecord);
}

export async function loadTapeRange(
  pool: Pool,
  programId: string,
  after: Date,
  through: Date,
  limit = 5_000,
): Promise<TapeSnapshotRecord[]> {
  const result = await pool.query<SnapshotRow>(`
    SELECT
      event.chain_id,
      event.tx_hash,
      event.log_index,
      event.block_number,
      event.block_time,
      event.event_type,
      event.program_id,
      event.card_account,
      event.token_symbol,
      event.decimals,
      event.amount_raw,
      event.settlement_ccy,
      event.amount_usd,
      event.price_source,
      event.priced_at,
      event.source_id,
      event.provenance,
      event.finalized,
      account_tier.tier
    FROM spend_event AS event
    LEFT JOIN LATERAL (
      SELECT period.tier
      FROM tier_period AS period
      WHERE period.program_id = event.program_id
        AND period.card_account = event.card_account
        AND period.provenance = event.provenance
        AND period.valid_from <= event.block_time
        AND (period.valid_to IS NULL OR period.valid_to > event.block_time)
      ORDER BY period.valid_from DESC
      LIMIT 1
    ) AS account_tier ON true
    WHERE event.program_id = $1
      AND event.block_time > $2
      AND event.block_time <= $3
    ORDER BY event.block_time ASC, event.block_number ASC, event.log_index ASC
    LIMIT $4
  `, [programId, after, through, limit]);
  return result.rows.map(rowToRecord);
}

interface TierPeriodRow {
  program_id: string;
  card_account: `0x${string}`;
  tier: Tier;
  valid_from: Date;
  valid_to: Date | null;
  qualified_by: TierPeriod['qualifiedBy'];
  source_id: string;
  provenance: TierPeriod['provenance'];
}

export async function loadTierPeriods(pool: Pool, programId: string): Promise<TierPeriod[]> {
  const result = await pool.query<TierPeriodRow>(`
    SELECT program_id, card_account, tier, valid_from, valid_to, qualified_by, source_id, provenance
    FROM tier_period
    WHERE program_id = $1
    ORDER BY card_account, valid_from
  `, [programId]);
  return result.rows.map((row) => ({
    programId: row.program_id,
    cardAccount: row.card_account,
    tier: row.tier,
    validFrom: row.valid_from,
    validTo: row.valid_to,
    qualifiedBy: row.qualified_by,
    sourceId: row.source_id,
    provenance: row.provenance,
  }));
}

export interface TierSummary {
  sourceId: string;
  provenance: TierPeriod['provenance'];
  asOfBlock: number | null;
  population: Record<Tier, number>;
  flow30d: Record<Tier, number>;
  history: Array<{ at: string; population: Record<Tier, number> }>;
}

interface TierSummaryRow {
  tier: Tier;
  population: string | number;
  entries_30d: string | number;
  exits_30d: string | number;
}

interface TierHistoryRow {
  observed_at: Date;
  tier: Tier;
  population: string | number;
}

export async function loadTierSummary(pool: Pool, programId: string): Promise<TierSummary | null> {
  const sourceResult = await pool.query<{ source_id: string; provenance: TierPeriod['provenance']; block_number: string | number | null }>(`
    SELECT source.source_id, source.provenance, cursor.block_number
    FROM (
      SELECT source_id, provenance, count(*) AS rows
      FROM tier_period
      WHERE program_id = $1
      GROUP BY source_id, provenance
      ORDER BY CASE provenance WHEN 'measured' THEN 0 ELSE 1 END, rows DESC
      LIMIT 1
    ) AS source
    LEFT JOIN ingest_cursor AS cursor ON cursor.source_id = source.source_id
  `, [programId]);
  const selected = sourceResult.rows[0];
  if (!selected) return null;
  const result = await pool.query<TierSummaryRow>(`
    SELECT
      tier,
      count(*) FILTER (WHERE valid_to IS NULL) AS population,
      count(*) FILTER (WHERE valid_from >= now() - interval '30 days') AS entries_30d,
      count(*) FILTER (WHERE valid_to >= now() - interval '30 days') AS exits_30d
    FROM tier_period
    WHERE program_id = $1 AND source_id = $2
    GROUP BY tier
  `, [programId, selected.source_id]);
  const population = { core: 0, luxe: 0, pinnacle: 0, vip: 0 } satisfies Record<Tier, number>;
  const flow30d = { core: 0, luxe: 0, pinnacle: 0, vip: 0 } satisfies Record<Tier, number>;
  for (const row of result.rows) {
    population[row.tier] = Number(row.population);
    flow30d[row.tier] = Number(row.entries_30d) - Number(row.exits_30d);
  }
  const historyResult = await pool.query<TierHistoryRow>(`
    WITH points AS (
      SELECT generate_series(
        date_trunc('week', now() - interval '12 weeks'),
        date_trunc('week', now()),
        interval '1 week'
      ) AS observed_at
    )
    SELECT points.observed_at, tiers.tier, count(period.card_account) AS population
    FROM points
    CROSS JOIN (VALUES ('core'), ('luxe'), ('pinnacle'), ('vip')) AS tiers(tier)
    LEFT JOIN tier_period AS period
      ON period.program_id = $1
      AND period.source_id = $2
      AND period.tier = tiers.tier
      AND period.valid_from <= points.observed_at
      AND (period.valid_to IS NULL OR period.valid_to > points.observed_at)
    GROUP BY points.observed_at, tiers.tier
    ORDER BY points.observed_at, tiers.tier
  `, [programId, selected.source_id]);
  const historyByTime = new Map<string, Record<Tier, number>>();
  for (const row of historyResult.rows) {
    const at = row.observed_at.toISOString();
    const values = historyByTime.get(at) ?? { core: 0, luxe: 0, pinnacle: 0, vip: 0 };
    values[row.tier] = Number(row.population);
    historyByTime.set(at, values);
  }
  return {
    sourceId: selected.source_id,
    provenance: selected.provenance,
    asOfBlock: selected.block_number === null ? null : Number(selected.block_number),
    population,
    flow30d,
    history: [...historyByTime].map(([at, values]) => ({ at, population: values })),
  };
}

interface NotificationEvent extends Omit<SpendEvent, 'blockTime' | 'pricedAt'> {
  blockTime: string;
  pricedAt: string | null;
}

export function spendEventNotification(event: SpendEvent): NotificationEvent {
  return {
    ...event,
    blockTime: event.blockTime.toISOString(),
    pricedAt: event.pricedAt?.toISOString() ?? null,
  };
}

export function parseSpendEventNotification(payload: string): SpendEvent {
  const event = JSON.parse(payload) as NotificationEvent;
  if (!event.txHash || !event.cardAccount || !event.blockTime || !event.programId) {
    throw new Error('Invalid spend event notification payload.');
  }
  return {
    ...event,
    blockTime: new Date(event.blockTime),
    pricedAt: event.pricedAt ? new Date(event.pricedAt) : null,
  };
}

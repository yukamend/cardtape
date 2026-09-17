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
        AND period.valid_from <= event.block_time
        AND (period.valid_to IS NULL OR period.valid_to > event.block_time)
      ORDER BY period.valid_from DESC
      LIMIT 1
    ) AS account_tier ON true
    WHERE event.program_id = $1
      AND event.block_time <= $2
    ORDER BY event.block_time DESC, event.block_number DESC, event.log_index DESC
    LIMIT $3
  `, [programId, asOf, limit]);
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
}

export async function loadTierPeriods(pool: Pool, programId: string): Promise<TierPeriod[]> {
  const result = await pool.query<TierPeriodRow>(`
    SELECT program_id, card_account, tier, valid_from, valid_to, qualified_by
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
  }));
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

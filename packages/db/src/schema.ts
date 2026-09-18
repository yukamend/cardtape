import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  check,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  primaryKey,
  text,
  timestamp,
} from 'drizzle-orm/pg-core';
import type {
  CampaignMechanic,
  CampaignSignature,
  FactProvenance,
  MetricProvenance,
  SettlementCurrency,
  SpendEventType,
  Tier,
  TierAction,
  TierQualification,
} from '../../core/src/types';

export const spendEvent = pgTable(
  'spend_event',
  {
    chainId: integer('chain_id').notNull(),
    txHash: text('tx_hash').notNull(),
    logIndex: integer('log_index').notNull(),
    blockNumber: bigint('block_number', { mode: 'number' }).notNull(),
    blockTime: timestamp('block_time', { withTimezone: true, mode: 'date' }).notNull(),
    eventType: text('event_type').$type<SpendEventType>().notNull(),
    programId: text('program_id').notNull(),
    cardAccount: text('card_account').notNull(),
    tokenSymbol: text('token_symbol').notNull(),
    decimals: integer('decimals').notNull(),
    amountRaw: numeric('amount_raw', { precision: 78, scale: 0 }).notNull(),
    settlementCcy: text('settlement_ccy').$type<SettlementCurrency>().notNull(),
    amountUsd: numeric('amount_usd', { precision: 20, scale: 4 }),
    priceSource: text('price_source'),
    pricedAt: timestamp('priced_at', { withTimezone: true, mode: 'date' }),
    sourceId: text('source_id').notNull(),
    provenance: text('provenance').$type<FactProvenance>().notNull(),
    finalized: boolean('finalized').notNull().default(false),
  },
  (table) => [
    primaryKey({ columns: [table.chainId, table.txHash, table.logIndex] }),
    check('spend_event_amount_raw_nonnegative', sql`${table.amountRaw} >= 0`),
    check('spend_event_decimals_range', sql`${table.decimals} BETWEEN 0 AND 36`),
    check('spend_event_provenance_check', sql`${table.provenance} IN ('measured', 'demo')`),
    check('spend_event_currency_check', sql`${table.settlementCcy} IN ('USD', 'EUR', 'GBP')`),
    check('spend_event_type_check', sql`${table.eventType} IN ('spend', 'top_up', 'cashback', 'settlement')`),
    index('spend_event_program_time_idx').on(table.programId, table.blockTime),
    index('spend_event_account_time_idx').on(table.cardAccount, table.blockTime),
    index('spend_event_source_block_idx').on(table.sourceId, table.blockNumber),
  ],
);

export const campaign = pgTable(
  'campaign',
  {
    id: text('id').primaryKey(),
    programId: text('program_id').notNull(),
    name: text('name').notNull(),
    sourceUrl: text('source_url').notNull(),
    announcedAt: timestamp('announced_at', { withTimezone: true, mode: 'date' }),
    startsAt: timestamp('starts_at', { withTimezone: true, mode: 'date' }).notNull(),
    endsAt: timestamp('ends_at', { withTimezone: true, mode: 'date' }).notNull(),
    payoutAt: timestamp('payout_at', { withTimezone: true, mode: 'date' }),
    mechanic: text('mechanic').$type<CampaignMechanic>().notNull(),
    eligibleTiers: text('eligible_tiers').array().$type<Tier[]>().notNull(),
    controlTiers: text('control_tiers').array().$type<Tier[]>().notNull(),
    region: text('region'),
    statedBudgetUsd: numeric('stated_budget_usd', { precision: 20, scale: 4 }),
    signature: jsonb('signature').$type<CampaignSignature>().notNull(),
    methodNote: text('method_note').notNull(),
  },
  (table) => [check('campaign_date_order', sql`${table.endsAt} > ${table.startsAt}`)],
);

export const tierPeriod = pgTable(
  'tier_period',
  {
    programId: text('program_id').notNull(),
    cardAccount: text('card_account').notNull(),
    tier: text('tier').$type<Tier>().notNull(),
    validFrom: timestamp('valid_from', { withTimezone: true, mode: 'date' }).notNull(),
    validTo: timestamp('valid_to', { withTimezone: true, mode: 'date' }),
    qualifiedBy: text('qualified_by').$type<TierQualification>().notNull(),
    sourceId: text('source_id').notNull(),
    provenance: text('provenance').$type<FactProvenance>().notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.programId, table.cardAccount, table.validFrom, table.sourceId] }),
    check('tier_period_date_order', sql`${table.validTo} IS NULL OR ${table.validTo} > ${table.validFrom}`),
    check('tier_period_tier_check', sql`${table.tier} IN ('core', 'luxe', 'pinnacle', 'vip')`),
    check('tier_period_qualification_check', sql`${table.qualifiedBy} IN ('sethfi', 'liquid', 'points', 'paid', 'unknown')`),
    check('tier_period_provenance_check', sql`${table.provenance} IN ('measured', 'demo')`),
    index('tier_period_account_interval_idx').on(table.programId, table.cardAccount, table.validFrom, table.validTo),
    index('tier_period_source_current_idx').on(table.sourceId, table.validTo),
  ],
);

export const tierEvent = pgTable(
  'tier_event',
  {
    chainId: integer('chain_id').notNull(),
    txHash: text('tx_hash').notNull(),
    logIndex: integer('log_index').notNull(),
    blockNumber: bigint('block_number', { mode: 'number' }).notNull(),
    blockTime: timestamp('block_time', { withTimezone: true, mode: 'date' }).notNull(),
    programId: text('program_id').notNull(),
    cardAccount: text('card_account').notNull(),
    action: text('action').$type<TierAction>().notNull(),
    asset: text('asset').$type<'ETHFI' | 'LIQUID'>().notNull(),
    amountRaw: numeric('amount_raw', { precision: 78, scale: 0 }).notNull(),
    sourceId: text('source_id').notNull(),
    provenance: text('provenance').$type<FactProvenance>().notNull(),
    finalized: boolean('finalized').notNull().default(false),
  },
  (table) => [
    primaryKey({ columns: [table.chainId, table.txHash, table.logIndex] }),
    check('tier_event_amount_raw_nonnegative', sql`${table.amountRaw} >= 0`),
    check('tier_event_action_check', sql`${table.action} IN ('stake', 'unstake', 'deposit', 'withdraw')`),
    check('tier_event_asset_check', sql`${table.asset} IN ('ETHFI', 'LIQUID')`),
    check('tier_event_provenance_check', sql`${table.provenance} IN ('measured', 'demo')`),
    index('tier_event_program_time_idx').on(table.programId, table.blockTime),
    index('tier_event_account_time_idx').on(table.cardAccount, table.blockTime),
    index('tier_event_source_block_idx').on(table.sourceId, table.blockNumber),
  ],
);

export const campaignResult = pgTable(
  'campaign_result',
  {
    campaignId: text('campaign_id').notNull().references(() => campaign.id),
    metric: text('metric').notNull(),
    value: numeric('value', { precision: 20, scale: 4 }),
    ciLow: numeric('ci_low', { precision: 20, scale: 4 }),
    ciHigh: numeric('ci_high', { precision: 20, scale: 4 }),
    provenance: text('provenance').$type<MetricProvenance>().notNull(),
    methodNote: text('method_note').notNull(),
    computedAt: timestamp('computed_at', { withTimezone: true, mode: 'date' }).notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.campaignId, table.metric] }),
    check('campaign_result_provenance_check', sql`${table.provenance} IN ('measured', 'inferred', 'estimated', 'demo')`),
    check('campaign_result_ci_order', sql`${table.ciLow} IS NULL OR ${table.ciHigh} IS NULL OR ${table.ciHigh} >= ${table.ciLow}`),
    index('campaign_result_computed_at_idx').on(table.computedAt),
  ],
);

export const marketPrice = pgTable(
  'market_price',
  {
    sourceId: text('source_id').notNull(),
    symbol: text('symbol').$type<'ETHFI' | 'BTC'>().notNull(),
    observedAt: timestamp('observed_at', { withTimezone: true, mode: 'date' }).notNull(),
    priceUsd: numeric('price_usd', { precision: 30, scale: 10 }).notNull(),
    volumeUsd: numeric('volume_usd', { precision: 30, scale: 4 }).notNull(),
    provenance: text('provenance').$type<FactProvenance>().notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.sourceId, table.symbol, table.observedAt] }),
    check('market_price_positive', sql`${table.priceUsd} > 0 AND ${table.volumeUsd} >= 0`),
    check('market_price_provenance_check', sql`${table.provenance} IN ('measured', 'demo')`),
    index('market_price_symbol_time_idx').on(table.symbol, table.observedAt),
  ],
);

export const ingestCursor = pgTable('ingest_cursor', {
  sourceId: text('source_id').primaryKey(),
  blockNumber: bigint('block_number', { mode: 'number' }).notNull(),
  blockHash: text('block_hash'),
  updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull(),
});

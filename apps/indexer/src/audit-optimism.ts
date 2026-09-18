import 'dotenv/config';
import { OptimismSource, OPTIMISM_SOURCE_ID } from '../../../packages/adapters/src/optimism';
import type { SpendEvent, TierEvent } from '../../../packages/core/src/types';
import { createDatabase, requireDatabaseUrl } from '../../../packages/db/src/client';
import { getIngestCursor } from '../../../packages/db/src/repository';

interface StoredSpendRow {
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
}

interface StoredTierRow {
  chain_id: number;
  tx_hash: `0x${string}`;
  log_index: number;
  block_number: string | number;
  block_time: Date;
  program_id: string;
  card_account: `0x${string}`;
  action: TierEvent['action'];
  asset: TierEvent['asset'];
  amount_raw: string;
  source_id: string;
  provenance: TierEvent['provenance'];
  finalized: boolean;
}

interface Comparison {
  raw: number;
  stored: number;
  missing: string[];
  unexpected: string[];
  mismatched: Array<{ key: string; raw: unknown; stored: unknown }>;
  duplicateRawKeys: number;
}

interface ComparableFact {
  key: string;
  fact: object;
}

export interface OptimismAuditReport {
  sourceId: string;
  head: number;
  storedCursor: number;
  fromBlock: number;
  throughBlock: number;
  spend: Comparison;
  tier: Comparison;
  passed: boolean;
}

function positiveInteger(value: string | undefined, fallback: number, name: string): number {
  const parsed = value === undefined ? fallback : Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) throw new Error(`${name} must be a positive integer`);
  return parsed;
}

function argument(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index === -1 ? undefined : process.argv[index + 1];
}

function eventKey(row: Pick<SpendEvent | TierEvent, 'chainId' | 'txHash' | 'logIndex'>): string {
  return `${row.chainId}:${row.txHash.toLowerCase()}:${row.logIndex}`;
}

function canonicalDecimal(value: string | null): string | null {
  if (value === null) return null;
  const [integer, fraction = ''] = value.split('.');
  const trimmed = fraction.replace(/0+$/, '');
  return trimmed ? `${integer}.${trimmed}` : integer ?? '0';
}

export function storedUsdPrecision(value: string | null): string | null {
  if (value === null) return null;
  const negative = value.startsWith('-');
  const absolute = negative ? value.slice(1) : value;
  const [integer = '0', fraction = ''] = absolute.split('.');
  const digits = fraction.padEnd(5, '0');
  let scaled = BigInt(integer) * 10_000n + BigInt(digits.slice(0, 4));
  if (Number(digits[4]) >= 5) scaled += 1n;
  const whole = scaled / 10_000n;
  const remainder = (scaled % 10_000n).toString().padStart(4, '0');
  return canonicalDecimal(`${negative ? '-' : ''}${whole}.${remainder}`);
}

function spendFact(row: SpendEvent): object {
  return {
    chainId: row.chainId,
    txHash: row.txHash.toLowerCase(),
    logIndex: row.logIndex,
    blockNumber: row.blockNumber,
    blockTime: row.blockTime.toISOString(),
    eventType: row.eventType,
    programId: row.programId,
    cardAccount: row.cardAccount.toLowerCase(),
    tokenSymbol: row.tokenSymbol,
    decimals: row.decimals,
    amountRaw: row.amountRaw,
    settlementCcy: row.settlementCcy,
    amountUsd: storedUsdPrecision(row.amountUsd),
    priceSource: row.priceSource,
    pricedAt: row.pricedAt?.toISOString() ?? null,
    sourceId: row.sourceId,
    provenance: row.provenance,
    finalized: row.finalized,
  };
}

function storedSpendFact(row: StoredSpendRow): object {
  return spendFact({
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
  });
}

function tierFact(row: TierEvent): object {
  return {
    chainId: row.chainId,
    txHash: row.txHash.toLowerCase(),
    logIndex: row.logIndex,
    blockNumber: row.blockNumber,
    blockTime: row.blockTime.toISOString(),
    programId: row.programId,
    cardAccount: row.cardAccount.toLowerCase(),
    action: row.action,
    asset: row.asset,
    amountRaw: row.amountRaw,
    sourceId: row.sourceId,
    provenance: row.provenance,
    finalized: row.finalized,
  };
}

function storedTierFact(row: StoredTierRow): object {
  return tierFact({
    chainId: row.chain_id,
    txHash: row.tx_hash,
    logIndex: row.log_index,
    blockNumber: Number(row.block_number),
    blockTime: row.block_time,
    programId: row.program_id,
    cardAccount: row.card_account,
    action: row.action,
    asset: row.asset,
    amountRaw: row.amount_raw,
    sourceId: row.source_id,
    provenance: row.provenance,
    finalized: row.finalized,
  });
}

function compare(rawRows: readonly ComparableFact[], storedRows: readonly ComparableFact[]): Comparison {
  const raw = new Map<string, string>();
  let duplicateRawKeys = 0;
  for (const row of rawRows) {
    if (raw.has(row.key)) duplicateRawKeys += 1;
    raw.set(row.key, JSON.stringify(row.fact));
  }
  const stored = new Map(storedRows.map((row) => [row.key, JSON.stringify(row.fact)]));
  const missing = [...raw.keys()].filter((rowKey) => !stored.has(rowKey));
  const unexpected = [...stored.keys()].filter((rowKey) => !raw.has(rowKey));
  const mismatched = [...raw.keys()]
    .filter((rowKey) => stored.has(rowKey) && stored.get(rowKey) !== raw.get(rowKey))
    .map((rowKey) => ({
      key: rowKey,
      raw: JSON.parse(raw.get(rowKey) ?? 'null') as unknown,
      stored: JSON.parse(stored.get(rowKey) ?? 'null') as unknown,
    }));
  return {
    raw: rawRows.length,
    stored: storedRows.length,
    missing: missing.slice(0, 10),
    unexpected: unexpected.slice(0, 10),
    mismatched: mismatched.slice(0, 3),
    duplicateRawKeys,
  };
}

function passed(comparison: Comparison): boolean {
  return comparison.raw === comparison.stored
    && comparison.missing.length === 0
    && comparison.unexpected.length === 0
    && comparison.mismatched.length === 0
    && comparison.duplicateRawKeys === 0;
}

export async function auditOptimism(blocks = 1_000): Promise<OptimismAuditReport> {
  const confirmations = positiveInteger(process.env.OPTIMISM_CONFIRMATIONS, 20, 'OPTIMISM_CONFIRMATIONS');
  const source = new OptimismSource({
    rpcUrl: process.env.OPTIMISM_RPC_URL?.trim() || 'https://mainnet.optimism.io',
    confirmations,
  });
  const { db, pool } = createDatabase(requireDatabaseUrl());
  try {
    const storedCursor = await getIngestCursor(db, OPTIMISM_SOURCE_ID);
    if (!storedCursor) throw new Error(`No cursor exists for ${OPTIMISM_SOURCE_ID}`);
    const head = await source.getHead();
    const requestedThrough = argument('--through-block');
    const throughBlock = requestedThrough === undefined
      ? Math.min(storedCursor.blockNumber - confirmations, head - confirmations)
      : positiveInteger(requestedThrough, 0, '--through-block');
    if (throughBlock <= 0 || throughBlock > storedCursor.blockNumber || throughBlock > head - confirmations) {
      throw new Error('--through-block must be positive, persisted, and finalized');
    }
    const fromBlock = Math.max(1, throughBlock - blocks + 1);
    const beforeBlock = fromBlock - 1;
    const raw = await source.fetch({ blockNumber: beforeBlock, blockHash: await source.getBlockHash(beforeBlock) }, throughBlock - beforeBlock);
    if (raw.cursor.blockNumber !== throughBlock) throw new Error(`RPC audit ended at ${raw.cursor.blockNumber}, expected ${throughBlock}`);
    const rawSpend = raw.events.flatMap((event) => source.normalize(event));
    const rawTier = raw.events.flatMap((event) => source.normalizeTier(event));
    const [storedSpend, storedTier] = await Promise.all([
      pool.query<StoredSpendRow>(`
        SELECT chain_id, tx_hash, log_index, block_number, block_time, event_type, program_id,
          card_account, token_symbol, decimals, amount_raw, settlement_ccy, amount_usd,
          price_source, priced_at, source_id, provenance, finalized
        FROM spend_event
        WHERE source_id = $1 AND block_number BETWEEN $2 AND $3
      `, [OPTIMISM_SOURCE_ID, fromBlock, throughBlock]),
      pool.query<StoredTierRow>(`
        SELECT chain_id, tx_hash, log_index, block_number, block_time, program_id,
          card_account, action, asset, amount_raw, source_id, provenance, finalized
        FROM tier_event
        WHERE source_id = $1 AND block_number BETWEEN $2 AND $3
      `, [OPTIMISM_SOURCE_ID, fromBlock, throughBlock]),
    ]);
    const spend = compare(
      rawSpend.map((row) => ({ key: eventKey(row), fact: spendFact(row) })),
      storedSpend.rows.map((row) => ({
        key: eventKey({ chainId: row.chain_id, txHash: row.tx_hash, logIndex: row.log_index }),
        fact: storedSpendFact(row),
      })),
    );
    const tier = compare(
      rawTier.map((row) => ({ key: eventKey(row), fact: tierFact(row) })),
      storedTier.rows.map((row) => ({
        key: eventKey({ chainId: row.chain_id, txHash: row.tx_hash, logIndex: row.log_index }),
        fact: storedTierFact(row),
      })),
    );
    return {
      sourceId: OPTIMISM_SOURCE_ID,
      head,
      storedCursor: storedCursor.blockNumber,
      fromBlock,
      throughBlock,
      spend,
      tier,
      passed: passed(spend) && passed(tier),
    };
  } finally {
    await pool.end();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const report = await auditOptimism(positiveInteger(argument('--blocks'), 1_000, '--blocks'));
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (!report.passed) process.exitCode = 1;
}

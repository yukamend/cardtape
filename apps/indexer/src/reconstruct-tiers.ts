import 'dotenv/config';
import { createPublicClient, http, parseAbi, type Address, type Hex } from 'viem';
import { optimism } from 'viem/chains';
import { OPTIMISM_CONTRACTS } from '../../../packages/adapters/src/optimism';
import { PROGRAM_ID } from '../../../packages/core/src/campaigns';
import { reconstructTierPeriods } from '../../../packages/core/src/tier-periods';
import type { OnchainTier, TierTransition } from '../../../packages/core/src/types';
import { createDatabase, requireDatabaseUrl } from '../../../packages/db/src/client';
import { replaceTierPeriodsForSource } from '../../../packages/db/src/repository';

export const TIER_PERIOD_SOURCE_ID = 'etherfi-cash:tiers-v1';

const reconstructionAbi = parseAbi([
  'event BeaconProxyDeployed(bytes32 salt, address indexed deployed)',
  'event SafeTiersSet(address[] safes, uint8[] tiers)',
]);
const cashModuleAbi = parseAbi(['function getSafeTier(address safe) view returns (uint8)']);

interface RawTransition extends Omit<TierTransition, 'at'> {
  at?: Date;
}

export interface TierReconstructionSummary {
  sourceId: string;
  finalizedBlock: number;
  deploymentBlock: number;
  safeCount: number;
  tierChangeCount: number;
  periodCount: number;
  businessCount: number;
  population: Record<Exclude<OnchainTier, 'business'>, number>;
  reconciliation: {
    factoryDeploymentsMatch: boolean;
    contractReadFailures: number;
    currentTierMismatches: number;
  };
}

function configuredRpcUrl(): string {
  return process.env.OPTIMISM_RPC_URL?.trim() || 'https://mainnet.optimism.io';
}

function createTierClient() {
  return createPublicClient({
    chain: optimism,
    transport: http(configuredRpcUrl(), { retryCount: 3, timeout: 20_000 }),
  });
}

type TierClient = ReturnType<typeof createTierClient>;

async function rpcRetry<T>(label: string, load: () => Promise<T>): Promise<T> {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    try {
      return await load();
    } catch (error) {
      const transient = /RpcRequestError|UnknownRpcError|requests per second|rate limit|capacity|backend|timeout|fetch failed|HTTP 429|HTTP 5\d\d/i.test(String(error));
      if (!transient || attempt === 7) throw error;
      const waitMs = Math.min(30_000, 1_000 * 2 ** attempt);
      process.stderr.write(`${label} failed; retrying in ${waitMs}ms.\n`);
      await wait(waitMs);
    }
  }
  throw new Error(`${label} exhausted retries`);
}

function onchainTier(value: number): OnchainTier {
  const tiers = ['core', 'luxe', 'pinnacle', 'vip', 'business'] as const;
  const tier = tiers[value];
  if (!tier) throw new Error(`Unknown Cash SafeTiers enum value: ${value}`);
  return tier;
}

function embeddedBlockTime(log: unknown): Date | undefined {
  const value = (log as { blockTimestamp?: Hex | bigint }).blockTimestamp;
  if (typeof value === 'bigint') return new Date(Number(value) * 1_000);
  if (typeof value === 'string') return new Date(Number(BigInt(value)) * 1_000);
  return undefined;
}

async function deploymentBlock(client: TierClient, address: Address, through: number): Promise<number> {
  let low = 0;
  let high = through;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    const code = await rpcRetry('Deployment block lookup', () => client.getCode({ address, blockNumber: BigInt(middle) }));
    if (code && code !== '0x') high = middle;
    else low = middle + 1;
  }
  return low;
}

interface RpcBlockResponse {
  id: number;
  result?: { timestamp: `0x${string}` };
  error?: { code: number; message: string };
}

async function blockTimes(rpcUrl: string, blocks: readonly number[]): Promise<Map<number, Date>> {
  const result = new Map<number, Date>();
  const unique = [...new Set(blocks)];
  for (let index = 0; index < unique.length; index += 10) {
    const batch = unique.slice(index, index + 10);
    let decoded: RpcBlockResponse[] | null = null;
    for (let attempt = 0; attempt < 6; attempt += 1) {
      try {
        const response = await fetch(rpcUrl, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(batch.map((blockNumber) => ({ jsonrpc: '2.0', id: blockNumber, method: 'eth_getBlockByNumber', params: [`0x${blockNumber.toString(16)}`, false] }))),
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const body = await response.json() as RpcBlockResponse[] | RpcBlockResponse;
        decoded = Array.isArray(body) ? body : [body];
        if (decoded.length !== batch.length || decoded.some((row) => row.error || !row.result)) throw new Error('Incomplete block timestamp batch');
        break;
      } catch (error) {
        if (attempt === 5) throw error;
        await wait(500 * 2 ** attempt);
      }
    }
    if (!decoded) throw new Error(`Unable to resolve block timestamp batch at index ${index}`);
    for (const row of decoded) {
      if (!row.result) throw new Error(`Missing block ${row.id}`);
      result.set(row.id, new Date(Number(BigInt(row.result.timestamp)) * 1_000));
    }
    if (index % 100 === 0) process.stderr.write(`Timestamp batch ${Math.min(index + batch.length, unique.length)}/${unique.length}\n`);
    await wait(100);
  }
  return result;
}

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function adaptiveLogs<T>(from: number, to: number, load: (start: number, end: number) => Promise<T[]>): Promise<T[]> {
  const pending: Array<[number, number]> = [[from, to]];
  const result: T[] = [];
  while (pending.length > 0) {
    const range = pending.pop();
    if (!range) break;
    const [start, end] = range;
    try {
      let rows: T[] | null = null;
      for (let attempt = 0; attempt < 6; attempt += 1) {
        try {
          rows = await load(start, end);
          break;
        } catch (error) {
          if (!/requests per second|rate limit|capacity/i.test(String(error)) || attempt === 5) throw error;
          await wait(300 * 2 ** attempt);
        }
      }
      if (!rows) throw new Error(`RPC returned no rows for ${start}-${end}`);
      result.push(...rows);
    } catch (error) {
      const canSplit = start < end && /response too large|limit|range/i.test(String(error));
      if (!canSplit) throw error;
      const middle = Math.floor((start + end) / 2);
      pending.push([middle + 1, end], [start, middle]);
    }
  }
  return result;
}

function blockRanges(from: number, through: number, size: number): Array<[number, number]> {
  const ranges: Array<[number, number]> = [];
  for (let start = from; start <= through; start += size) ranges.push([start, Math.min(through, start + size - 1)]);
  return ranges;
}

export async function reconstructOptimismTiers(): Promise<TierReconstructionSummary> {
  const client = createTierClient();
  const head = Number(await rpcRetry('Head block lookup', () => client.getBlockNumber()));
  const confirmations = Number(process.env.OPTIMISM_CONFIRMATIONS ?? '20');
  const finalizedBlock = Math.max(0, head - confirmations);
  const [factoryStart, emitterStart] = await Promise.all([
    deploymentBlock(client, OPTIMISM_CONTRACTS.etherFiSafeFactory, finalizedBlock),
    deploymentBlock(client, OPTIMISM_CONTRACTS.cashEventEmitter, finalizedBlock),
  ]);
  const scanBlocks = Math.min(10_000, Math.max(1_000, Number(process.env.OP_TIER_SCAN_BLOCKS ?? '10000')));
  const transitions: RawTransition[] = [];
  const deployedSafes: Address[] = [];
  let tierChangeCount = 0;

  const ranges = blockRanges(Math.min(factoryStart, emitterStart), finalizedBlock, scanBlocks);
  for (let rangeIndex = 0; rangeIndex < ranges.length; rangeIndex += 2) {
    const rangeBatch = ranges.slice(rangeIndex, rangeIndex + 2);
    const logBatches = await Promise.all(rangeBatch.map(([from, to]) => adaptiveLogs(from, to, (start, end) => client.getLogs({
      address: [OPTIMISM_CONTRACTS.etherFiSafeFactory, OPTIMISM_CONTRACTS.cashEventEmitter],
      events: reconstructionAbi,
      fromBlock: BigInt(start),
      toBlock: BigInt(end),
    }))));
    for (const logs of logBatches) for (const log of logs) {
        if (log.blockNumber === null || log.logIndex === null) continue;
        if (log.eventName === 'BeaconProxyDeployed') {
          const safe = log.args.deployed;
          if (!safe) continue;
          deployedSafes.push(safe);
          transitions.push({ cardAccount: safe, tier: 'core', blockNumber: Number(log.blockNumber), logIndex: log.logIndex, arrayIndex: 0, qualifiedBy: 'unknown', at: embeddedBlockTime(log) });
        } else if (log.eventName === 'SafeTiersSet') {
          const safes = log.args.safes ?? [];
          const tiers = log.args.tiers ?? [];
          if (safes.length !== tiers.length) throw new Error(`Mismatched SafeTiersSet arrays at block ${log.blockNumber}`);
          for (let index = 0; index < safes.length; index += 1) {
            const safe = safes[index];
            const tier = tiers[index];
            if (!safe || tier === undefined) continue;
            transitions.push({ cardAccount: safe, tier: onchainTier(Number(tier)), blockNumber: Number(log.blockNumber), logIndex: log.logIndex, arrayIndex: index, qualifiedBy: 'unknown', at: embeddedBlockTime(log) });
            tierChangeCount += 1;
          }
        }
      }
    if (rangeIndex % 40 === 0) process.stderr.write(`Tier source scan ${Math.min(rangeIndex + rangeBatch.length, ranges.length)}/${ranges.length}\n`);
    await wait(350);
  }

  const missingTimestampBlocks = transitions.filter((transition) => !transition.at).map((transition) => transition.blockNumber);
  process.stderr.write(`Decoded ${transitions.length} tier transitions; ${new Set(missingTimestampBlocks).size} block timestamps require fallback.\n`);
  const timestamps = await blockTimes(configuredRpcUrl(), missingTimestampBlocks);
  const completeTransitions: TierTransition[] = transitions.map((transition) => {
    const at = transition.at ?? timestamps.get(transition.blockNumber);
    if (!at) throw new Error(`Missing timestamp for block ${transition.blockNumber}`);
    return { ...transition, at };
  });
  const reconstruction = reconstructTierPeriods(PROGRAM_ID, TIER_PERIOD_SOURCE_ID, 'measured', completeTransitions);

  let currentTierMismatches = 0;
  let contractReadFailures = 0;
  // Keep each aggregate below the public endpoint's response limit. Viem otherwise
  // defaults to 1 KiB chunks and bursts hundreds of concurrent RPC requests.
  const reconciliationBatchSize = 2_000;
  for (let index = 0; index < deployedSafes.length; index += reconciliationBatchSize) {
    const batch = deployedSafes.slice(index, index + reconciliationBatchSize);
    let pending = batch;
    const resolved = new Map<Address, OnchainTier>();
    for (let attempt = 0; attempt < 8 && pending.length > 0; attempt += 1) {
      const requested = pending;
      const results = await rpcRetry('Contract reconciliation', () => client.multicall({
        allowFailure: true,
        batchSize: 100_000,
        blockNumber: BigInt(finalizedBlock),
        contracts: requested.map((safe) => ({ address: OPTIMISM_CONTRACTS.cashModule, abi: cashModuleAbi, functionName: 'getSafeTier', args: [safe] })),
      }));
      const retry: Address[] = [];
      results.forEach((result, resultIndex) => {
        const safe = requested[resultIndex];
        if (!safe) return;
        if (result.status === 'success') resolved.set(safe, onchainTier(Number(result.result)));
        else retry.push(safe);
      });
      pending = retry;
      if (pending.length > 0 && attempt < 7) {
        const waitMs = Math.min(30_000, 500 * 2 ** attempt);
        process.stderr.write(`Retrying ${pending.length} tier reads in ${waitMs}ms.\n`);
        await wait(waitMs);
      }
    }
    contractReadFailures += pending.length;
    for (const [safe, tier] of resolved) {
      if (reconstruction.current.get(safe.toLowerCase() as `0x${string}`) !== tier) currentTierMismatches += 1;
    }
    if (index % 20_000 === 0) process.stderr.write(`Contract reconciliation ${Math.min(index + batch.length, deployedSafes.length)}/${deployedSafes.length}\n`);
    await wait(100);
  }

  const population = { core: 0, luxe: 0, pinnacle: 0, vip: 0 };
  let businessCount = 0;
  for (const tier of reconstruction.current.values()) {
    if (tier === 'business') businessCount += 1;
    else population[tier] += 1;
  }
  const factoryDeploymentsMatch = reconstruction.current.size === deployedSafes.length;
  if (!factoryDeploymentsMatch || contractReadFailures > 0 || currentTierMismatches > 0) {
    throw new Error(`Tier reconciliation failed: factoryMatch=${factoryDeploymentsMatch}, readFailures=${contractReadFailures}, mismatches=${currentTierMismatches}`);
  }
  const finalBlock = await rpcRetry('Finalized block lookup', () => client.getBlock({ blockNumber: BigInt(finalizedBlock), includeTransactions: false }));
  const { db, pool } = createDatabase(requireDatabaseUrl());
  try {
    await replaceTierPeriodsForSource(db, TIER_PERIOD_SOURCE_ID, reconstruction.periods, { blockNumber: finalizedBlock, blockHash: finalBlock.hash });
  } finally {
    await pool.end();
  }

  return {
    sourceId: TIER_PERIOD_SOURCE_ID,
    finalizedBlock,
    deploymentBlock: Math.min(factoryStart, emitterStart),
    safeCount: deployedSafes.length,
    tierChangeCount,
    periodCount: reconstruction.periods.length,
    businessCount,
    population,
    reconciliation: { factoryDeploymentsMatch, contractReadFailures, currentTierMismatches },
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const summary = await reconstructOptimismTiers();
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
  if (!summary.reconciliation.factoryDeploymentsMatch || summary.reconciliation.contractReadFailures > 0 || summary.reconciliation.currentTierMismatches > 0) process.exitCode = 1;
}

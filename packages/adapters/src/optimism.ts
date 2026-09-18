import {
  createPublicClient,
  formatUnits,
  http,
  parseAbi,
  type Address,
  type Hex,
  type Log,
} from 'viem';
import { optimism } from 'viem/chains';
import { PROGRAM_ID } from '../../core/src/campaigns';
import type { Cursor, RawEvent, SpendEvent, SpendSource, TierEvent } from '../../core/src/types';

export const OPTIMISM_SOURCE_ID = 'etherfi-cash:optimism-v1';

export const OPTIMISM_CONTRACTS = {
  cashEventEmitter: '0x380B2e96799405be6e3D965f4044099891881acB',
  cashModule: '0x7Ca0b75E67E33c0014325B739A8d019C4FE445F0',
  etherFiSafeFactory: '0xF4e147Db314947fC1275a8CbB6Cde48c510cd8CF',
  etherFiLiquidModule: '0x427fDe7FF5D685e76f572BDFb896184a2048f232',
  etherFiLiquidModuleWithReferrer: '0xA051246A613E3216DD90402453D3B8aD63E71Cd1',
  cashbackDistributor: '0x38F2fBb259F042DE3A601E0f7135f768DE08F5A2',
} as const satisfies Record<string, Address>;

export const OPTIMISM_TOKENS = {
  usdc: '0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85',
  usdt: '0x94b008aA00579c1307B0EF2c499aD98a8ce58e58',
  weth: '0x4200000000000000000000000000000000000006',
  weeth: '0x5A7fACB970D094B6C7FF1df0eA68D99E6e73CBFF',
  ethfi: '0xe0080d2F853ecDdbd81A643dC10DA075Df26fD3f',
  sethfi: '0x86B5780b606940Eb59A062aA85a07959518c0161',
} as const satisfies Record<string, Address>;

const cashEvents = parseAbi([
  'event Spend(address indexed safe, bytes32 indexed txId, uint8 indexed binSponsor, address[] tokens, uint256[] amounts, uint256[] amountInUsd, uint256 totalUsdAmt, uint8 mode)',
  'event Cashback(address indexed safe, uint256 spendingInUsd, address indexed recipient, address cashbackToken, uint256 cashbackAmountInToken, uint256 cashbackInUsd, uint256 cashbackType, bool indexed paid)',
  'event PendingCashbackCleared(address indexed recipient, address cashbackToken, uint256 cashbackAmount, uint256 cashbackInUsd)',
]);

const liquidEvents = parseAbi([
  'event LiquidDeposit(address indexed safe, address indexed inputToken, address indexed outputToken, uint256 inputAmount, uint256 outputAmount)',
  'event LiquidWithdrawal(address indexed safe, address indexed liquidAsset, uint256 amountToWithdraw, uint256 amountOut)',
]);

const cashbackDistributorEvents = parseAbi([
  'event CashbackAwarded(bytes32 indexed claimId, address indexed recipient, address indexed token, uint256 amount, uint256 sEthfiAmount)',
]);

const erc20MetadataAbi = parseAbi([
  'function symbol() view returns (string)',
  'function decimals() view returns (uint8)',
]);

function createOptimismClient(rpcUrl: string) {
  return createPublicClient({ chain: optimism, transport: http(rpcUrl, { retryCount: 3, timeout: 15_000 }) });
}

interface TokenMetadata {
  symbol: string;
  decimals: number;
}

interface OptimismLogPayload {
  eventName: 'Spend' | 'Cashback' | 'PendingCashbackCleared' | 'LiquidDeposit' | 'LiquidWithdrawal' | 'CashbackAwarded';
  args: Record<string, unknown>;
  transactionHash: Hex;
  logIndex: number;
  blockNumber: number;
  blockHash: Hex;
  blockTime: Date;
  finalized: boolean;
  token?: TokenMetadata;
}

export interface OptimismFetchResult {
  events: RawEvent[];
  cursor: Cursor;
  head: number;
}

export interface OptimismSourceOptions {
  rpcUrl: string;
  confirmations?: number;
}

function isPayload(raw: RawEvent): raw is RawEvent & { payload: OptimismLogPayload } {
  if (!raw.payload || typeof raw.payload !== 'object') return false;
  return 'eventName' in raw.payload && 'transactionHash' in raw.payload && 'blockNumber' in raw.payload;
}

function address(value: unknown): `0x${string}` {
  if (typeof value !== 'string' || !/^0x[0-9a-fA-F]{40}$/.test(value)) throw new Error(`Invalid event address: ${String(value)}`);
  return value.toLowerCase() as `0x${string}`;
}

function bigint(value: unknown): bigint {
  if (typeof value !== 'bigint') throw new Error(`Invalid event integer: ${String(value)}`);
  return value;
}

function paid(value: unknown): boolean {
  if (typeof value !== 'boolean') throw new Error(`Invalid cashback paid flag: ${String(value)}`);
  return value;
}

function usdValue(raw: bigint): string {
  return formatUnits(raw, 6);
}

function logTimestamp(log: Log): bigint | null {
  const value = (log as unknown as { blockTimestamp?: Hex | bigint }).blockTimestamp;
  if (typeof value === 'bigint') return value;
  if (typeof value === 'string') return BigInt(value);
  return null;
}

function requireLogIdentity(log: Log): asserts log is Log & {
  transactionHash: Hex;
  logIndex: number;
  blockNumber: bigint;
  blockHash: Hex;
} {
  if (!log.transactionHash || log.logIndex === null || log.blockNumber === null || !log.blockHash) {
    throw new Error('Optimism returned a pending log without an immutable chain identity');
  }
}

export class OptimismSource implements SpendSource {
  readonly id = OPTIMISM_SOURCE_ID;
  readonly kind = 'measured' as const;
  readonly confirmations: number;
  private readonly client: ReturnType<typeof createOptimismClient>;
  private readonly tokenMetadata = new Map<string, TokenMetadata>();

  constructor(options: OptimismSourceOptions) {
    if (!options.rpcUrl.trim()) throw new Error('OPTIMISM_RPC_URL is required');
    this.confirmations = options.confirmations ?? 20;
    this.client = createOptimismClient(options.rpcUrl);
    this.seedTokenMetadata();
  }

  async getHead(): Promise<number> {
    return Number(await this.client.getBlockNumber());
  }

  async getBlockHash(blockNumber: number): Promise<Hex> {
    const block = await this.client.getBlock({ blockNumber: BigInt(blockNumber), includeTransactions: false });
    return block.hash;
  }

  async initialCursor(lookbackBlocks: number, explicitStartBlock?: number): Promise<Cursor> {
    const head = await this.getHead();
    const blockNumber = explicitStartBlock === undefined
      ? Math.max(0, head - Math.max(1, lookbackBlocks) - 1)
      : Math.max(0, Math.min(head, explicitStartBlock - 1));
    return { blockNumber, blockHash: await this.getBlockHash(blockNumber) };
  }

  async fetch(cursor: Cursor, limit: number): Promise<OptimismFetchResult> {
    const head = await this.getHead();
    if (cursor.blockNumber >= head) return { events: [], cursor, head };
    const fromBlock = BigInt(cursor.blockNumber + 1);
    const toBlock = BigInt(Math.min(head, cursor.blockNumber + Math.max(1, limit)));

    const [cashLogs, liquidLogs, distributorLogs] = await Promise.all([
      this.client.getLogs({ address: OPTIMISM_CONTRACTS.cashEventEmitter, events: cashEvents, fromBlock, toBlock }),
      this.client.getLogs({ address: [OPTIMISM_CONTRACTS.etherFiLiquidModule, OPTIMISM_CONTRACTS.etherFiLiquidModuleWithReferrer], events: liquidEvents, fromBlock, toBlock }),
      this.client.getLogs({ address: OPTIMISM_CONTRACTS.cashbackDistributor, events: cashbackDistributorEvents, fromBlock, toBlock }),
    ]);
    const logs = [...cashLogs, ...liquidLogs, ...distributorLogs];
    const timestamps = await this.resolveTimestamps(logs);
    const finalizedThrough = head - this.confirmations;
    const events: RawEvent[] = [];

    for (const log of logs) {
      requireLogIdentity(log);
      if (!('eventName' in log) || typeof log.eventName !== 'string' || !('args' in log) || !log.args) continue;
      const blockNumber = Number(log.blockNumber);
      const blockTime = timestamps.get(blockNumber);
      if (!blockTime) throw new Error(`Missing timestamp for Optimism block ${blockNumber}`);
      const eventName = log.eventName as OptimismLogPayload['eventName'];
      const args = log.args as Record<string, unknown>;
      const tokenAddress = this.tokenAddress(eventName, args);
      events.push({
        payload: {
          eventName,
          args,
          transactionHash: log.transactionHash,
          logIndex: log.logIndex,
          blockNumber,
          blockHash: log.blockHash,
          blockTime,
          finalized: blockNumber <= finalizedThrough,
          token: tokenAddress ? await this.getTokenMetadata(tokenAddress) : undefined,
        } satisfies OptimismLogPayload,
      });
    }

    events.sort((left, right) => {
      if (!isPayload(left) || !isPayload(right)) return 0;
      return left.payload.blockNumber - right.payload.blockNumber || left.payload.logIndex - right.payload.logIndex;
    });
    const nextBlock = Number(toBlock);
    return {
      events,
      cursor: { blockNumber: nextBlock, blockHash: await this.getBlockHash(nextBlock) },
      head,
    };
  }

  normalize(raw: RawEvent): SpendEvent[] {
    if (!isPayload(raw)) return [];
    const payload = raw.payload;
    const common = {
      chainId: optimism.id,
      txHash: payload.transactionHash,
      logIndex: payload.logIndex,
      blockNumber: payload.blockNumber,
      blockTime: payload.blockTime,
      programId: PROGRAM_ID,
      settlementCcy: 'USD' as const,
      sourceId: this.id,
      provenance: this.kind,
      finalized: payload.finalized,
    };

    if (payload.eventName === 'Spend') {
      const totalUsdAmt = bigint(payload.args.totalUsdAmt);
      return [{
        ...common,
        eventType: 'spend',
        cardAccount: address(payload.args.safe),
        tokenSymbol: 'USD',
        decimals: 6,
        amountRaw: totalUsdAmt.toString(),
        amountUsd: usdValue(totalUsdAmt),
        priceSource: 'cash-v3:Spend.totalUsdAmt',
        pricedAt: payload.blockTime,
      }];
    }

    if (payload.eventName === 'Cashback') {
      if (!paid(payload.args.paid)) return [];
      const cashbackInUsd = bigint(payload.args.cashbackInUsd);
      return [{
        ...common,
        eventType: 'cashback',
        cardAccount: address(payload.args.recipient),
        tokenSymbol: payload.token?.symbol ?? 'UNKNOWN',
        decimals: payload.token?.decimals ?? 0,
        amountRaw: bigint(payload.args.cashbackAmountInToken).toString(),
        amountUsd: usdValue(cashbackInUsd),
        priceSource: 'cash-v3:Cashback.cashbackInUsd',
        pricedAt: payload.blockTime,
      }];
    }

    if (payload.eventName === 'PendingCashbackCleared') {
      const cashbackInUsd = bigint(payload.args.cashbackInUsd);
      return [{
        ...common,
        eventType: 'cashback',
        cardAccount: address(payload.args.recipient),
        tokenSymbol: payload.token?.symbol ?? 'UNKNOWN',
        decimals: payload.token?.decimals ?? 0,
        amountRaw: bigint(payload.args.cashbackAmount).toString(),
        amountUsd: usdValue(cashbackInUsd),
        priceSource: 'cash-v3:PendingCashbackCleared.cashbackInUsd',
        pricedAt: payload.blockTime,
      }];
    }

    if (payload.eventName === 'CashbackAwarded') {
      const stakedAmount = bigint(payload.args.sEthfiAmount);
      return [{
        ...common,
        eventType: 'cashback',
        cardAccount: address(payload.args.recipient),
        tokenSymbol: payload.token?.symbol ?? (stakedAmount > 0n ? 'sETHFI' : 'UNKNOWN'),
        decimals: payload.token?.decimals ?? 18,
        amountRaw: (stakedAmount > 0n ? stakedAmount : bigint(payload.args.amount)).toString(),
        amountUsd: null,
        priceSource: null,
        pricedAt: null,
      }];
    }

    return [];
  }

  normalizeTier(raw: RawEvent): TierEvent[] {
    if (!isPayload(raw)) return [];
    const payload = raw.payload;
    if (payload.eventName !== 'LiquidDeposit' && payload.eventName !== 'LiquidWithdrawal') return [];
    const liquidAsset = payload.eventName === 'LiquidDeposit'
      ? address(payload.args.outputToken)
      : address(payload.args.liquidAsset);
    const isSEthFi = liquidAsset.toLowerCase() === OPTIMISM_TOKENS.sethfi.toLowerCase();
    return [{
      chainId: optimism.id,
      txHash: payload.transactionHash,
      logIndex: payload.logIndex,
      blockNumber: payload.blockNumber,
      blockTime: payload.blockTime,
      programId: PROGRAM_ID,
      cardAccount: address(payload.args.safe),
      action: payload.eventName === 'LiquidDeposit' ? (isSEthFi ? 'stake' : 'deposit') : (isSEthFi ? 'unstake' : 'withdraw'),
      asset: isSEthFi ? 'ETHFI' : 'LIQUID',
      amountRaw: bigint(payload.eventName === 'LiquidDeposit' ? payload.args.outputAmount : payload.args.amountToWithdraw).toString(),
      sourceId: this.id,
      provenance: this.kind,
      finalized: payload.finalized,
    }];
  }

  private async resolveTimestamps(logs: readonly Log[]): Promise<Map<number, Date>> {
    const result = new Map<number, Date>();
    const missing = new Set<number>();
    for (const log of logs) {
      if (log.blockNumber === null) continue;
      const blockNumber = Number(log.blockNumber);
      const embedded = logTimestamp(log);
      if (embedded === null) missing.add(blockNumber);
      else result.set(blockNumber, new Date(Number(embedded) * 1_000));
    }
    await Promise.all([...missing].filter((blockNumber) => !result.has(blockNumber)).map(async (blockNumber) => {
      const block = await this.client.getBlock({ blockNumber: BigInt(blockNumber), includeTransactions: false });
      result.set(blockNumber, new Date(Number(block.timestamp) * 1_000));
    }));
    return result;
  }

  private tokenAddress(eventName: OptimismLogPayload['eventName'], args: Record<string, unknown>): Address | null {
    if (eventName === 'Cashback' || eventName === 'PendingCashbackCleared') return address(args.cashbackToken);
    if (eventName === 'CashbackAwarded') return address(args.token);
    return null;
  }

  private async getTokenMetadata(token: Address): Promise<TokenMetadata> {
    const key = token.toLowerCase();
    const cached = this.tokenMetadata.get(key);
    if (cached) return cached;
    const [symbol, decimals] = await Promise.all([
      this.client.readContract({ address: token, abi: erc20MetadataAbi, functionName: 'symbol' }),
      this.client.readContract({ address: token, abi: erc20MetadataAbi, functionName: 'decimals' }),
    ]);
    const metadata = { symbol, decimals };
    this.tokenMetadata.set(key, metadata);
    return metadata;
  }

  private seedTokenMetadata(): void {
    const known: readonly [Address, TokenMetadata][] = [
      [OPTIMISM_TOKENS.usdc, { symbol: 'USDC', decimals: 6 }],
      [OPTIMISM_TOKENS.usdt, { symbol: 'USDT', decimals: 6 }],
      [OPTIMISM_TOKENS.weth, { symbol: 'WETH', decimals: 18 }],
      [OPTIMISM_TOKENS.weeth, { symbol: 'weETH', decimals: 18 }],
      [OPTIMISM_TOKENS.ethfi, { symbol: 'ETHFI', decimals: 18 }],
      [OPTIMISM_TOKENS.sethfi, { symbol: 'sETHFI', decimals: 18 }],
    ];
    for (const [token, metadata] of known) this.tokenMetadata.set(token.toLowerCase(), metadata);
  }
}

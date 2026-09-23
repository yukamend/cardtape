import { createPublicClient, http, parseAbiItem, type Address } from 'viem';
import { plasma } from 'viem/chains';
import type { CampaignImpact, CampaignMetric, CampaignTrendPoint, ImpactVerdict } from '../../core/src/neobanks';
import type { CampaignMetricsQuery } from './campaign-metrics';

export const PLASMA_LOCK_VAULT: Address = '0xe035a6a5aba726bd162e273a22ff85ae5f6e04c3';
const WXPL: Address = '0x6100E367285b01F48D07953803A2d8dCA5D19873';
const PLATINUM_SIZE = 100_000n * 10n ** 18n;
const lockedEvent = parseAbiItem('event Locked(uint256 indexed lockId, address indexed beneficiary, address indexed token, address depositor, address withdrawalAddress, uint256 amount, uint256 releaseTime)');
const client = createPublicClient({ chain: plasma, transport: http(process.env.PLASMA_RPC_URL?.trim() || 'https://rpc.plasma.to', { retryCount: 3, timeout: 15_000 }) });

type LockLog = Awaited<ReturnType<typeof client.getLogs<typeof lockedEvent>>>[number];
const cache = new Map<string, { until: number; value: CampaignImpact }>();

async function blockAtOrAfter(timestamp: number, head: bigint): Promise<bigint> {
  let low = 0n;
  let high = head;
  while (low < high) {
    const middle = (low + high) / 2n;
    const block = await client.getBlock({ blockNumber: middle, includeTransactions: false });
    if (Number(block.timestamp) * 1000 < timestamp) low = middle + 1n;
    else high = middle;
  }
  return low;
}

async function loadLocks(from: bigint, through: bigint): Promise<LockLog[]> {
  if (through < from) return [];
  const ranges: Array<{ fromBlock: bigint; toBlock: bigint }> = [];
  for (let block = from; block <= through; block += 9_000n) {
    ranges.push({ fromBlock: block, toBlock: block + 8_999n < through ? block + 8_999n : through });
    if (ranges.length > 2_000) throw new Error('Plasma scan range exceeds the supported monitor window');
  }
  const results: LockLog[][] = Array.from({ length: ranges.length }, () => []);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(4, ranges.length) }, async () => {
    while (next < ranges.length) {
      const index = next++;
      results[index] = await client.getLogs({ address: PLASMA_LOCK_VAULT, event: lockedEvent, args: { token: WXPL }, ...ranges[index] });
    }
  }));
  return results.flat();
}

function metric(input: {
  id: string; label: string; format: CampaignMetric['format'];
  campaign: number; baseline: number; period: CampaignMetricsQuery['campaignPeriod'];
  updated: string; inferred: boolean; note: string;
}): CampaignMetric {
  return {
    id: input.id, label: input.label, format: input.format,
    campaignValue: input.campaign, baselineValue: input.baseline,
    changeValue: input.baseline === 0 ? null : ((input.campaign - input.baseline) / input.baseline) * 100,
    changeUnit: 'percent', interpretation: input.note,
    evidence: {
      kind: input.inferred ? 'inferred' : 'live', confidence: input.inferred ? 'medium' : 'high',
      sourceIds: ['plasma-one-lock-vault'], observationPeriod: input.period,
      lastUpdatedAt: input.updated,
      note: input.inferred
        ? 'Locked events of at least 100,000 WXPL are a Platinum-sized proxy. Smaller top-ups can also unlock Platinum, and a lock does not prove card activation.'
        : 'Decoded Locked events from the Plasma One XPL vault. These are token locks, not card signups or purchases.',
    },
  };
}

export async function getPlasmaImpact(query: CampaignMetricsQuery): Promise<CampaignImpact> {
  if (query.campaignId !== 'plasma-one-platinum-locks') throw new Error('Unknown Plasma monitor');
  const start = new Date(query.campaignPeriod.start).getTime();
  const end = new Date(query.campaignPeriod.end).getTime();
  const baselineStart = new Date(query.baselinePeriod.start).getTime();
  const baselineEnd = new Date(query.baselinePeriod.end).getTime();
  const now = Date.now();
  if (![start, end, baselineStart, baselineEnd].every(Number.isFinite)
    || start >= end || baselineStart >= baselineEnd || baselineEnd > start
    || end - start > 8 * 86_400_000 || start - baselineStart > 31 * 86_400_000
    || end > now + 60_000 || end < now - 5 * 60_000) throw new Error('Invalid Plasma monitor window');
  const cacheKey = `${baselineStart}:${end}`;
  const cached = cache.get(cacheKey);
  if (cached && cached.until > now) return cached.value;
  for (const [key, entry] of cache) if (entry.until <= now) cache.delete(key);

  const head = await client.getBlockNumber();
  const [from, split, to, headBlock] = await Promise.all([
    blockAtOrAfter(baselineStart, head), blockAtOrAfter(start, head),
    blockAtOrAfter(end, head),
    client.getBlock({ blockNumber: head, includeTransactions: false }),
  ]);
  const logs = await loadLocks(from, to > head ? head : to - 1n);
  const selected = logs.filter((log) => log.args.token?.toLowerCase() === WXPL.toLowerCase());
  const before = selected.filter((log) => log.blockNumber < split);
  const during = selected.filter((log) => log.blockNumber >= split);
  const platinum = (rows: LockLog[]) => rows.filter((log) => (log.args.amount ?? 0n) >= PLATINUM_SIZE).length;
  const daysDuring = (end - start) / 86_400_000;
  const daysBefore = (baselineEnd - baselineStart + 1) / 86_400_000;
  const platinumDuring = platinum(during) / daysDuring;
  const platinumBefore = platinum(before) / daysBefore;
  const verdict: ImpactVerdict = platinumDuring > platinumBefore ? 'positive' : platinumDuring < platinumBefore ? 'negative' : 'neutral';
  const updated = new Date(Number(headBlock.timestamp) * 1000).toISOString();
  const trend: CampaignTrendPoint[] = [];
  for (let at = baselineStart; at < end; at += 86_400_000) {
    const next = Math.min(end, at + 86_400_000);
    const value = selected.filter((log) => {
      const timestamp = Number((log as LockLog & { blockTimestamp?: bigint }).blockTimestamp ?? 0n) * 1000;
      return timestamp >= at && timestamp < next && (log.args.amount ?? 0n) >= PLATINUM_SIZE;
    }).length;
    trend.push({ date: new Date(at).toISOString(), value, phase: at < start ? 'baseline' : 'campaign' });
  }
  const metrics = [
    metric({ id: 'platinum-sized-locks', label: 'Platinum-sized locks / day', format: 'number', campaign: platinumDuring, baseline: platinumBefore, period: query.campaignPeriod, updated, inferred: true, note: 'New vault lock events of at least 100,000 WXPL per day; an imperfect proxy for Platinum demand, not a signup count.' }),
    metric({ id: 'vault-locks', label: 'All vault locks / day', format: 'number', campaign: during.length / daysDuring, baseline: before.length / daysBefore, period: query.campaignPeriod, updated, inferred: false, note: 'All new WXPL lock events, across membership tiers.' }),
    metric({ id: 'wxpl-locked', label: 'WXPL newly locked / day', format: 'number', campaign: during.reduce((sum, log) => sum + Number(log.args.amount ?? 0n) / 1e18, 0) / daysDuring, baseline: before.reduce((sum, log) => sum + Number(log.args.amount ?? 0n) / 1e18, 0) / daysBefore, period: query.campaignPeriod, updated, inferred: false, note: 'New WXPL deposited in the vault per day; excludes withdrawals and USD valuation.' }),
  ];
  const result: CampaignImpact = {
    neobankId: 'plasma-one', campaignId: query.campaignId, verdict,
    conclusion: 'Plasma One vault lock activity is observable onchain. Platinum-sized locks are a proxy for upgrades; card signups, activations and FX fees are not visible here.',
    campaignPeriod: query.campaignPeriod, baselinePeriod: query.baselinePeriod, metrics,
    trend,
    limitations: [
      'The vault contains locks for multiple tiers. A 100,000 WXPL lock is Platinum-sized, while a smaller top-up can also upgrade an existing member.',
      'A vault lock does not confirm a completed signup, KYC, card activation or purchase.',
      'The 0% FX benefit is described by Plasma; the vault does not emit card FX fee data.',
    ],
  };
  cache.set(cacheKey, { until: now + 60_000, value: result });
  return result;
}

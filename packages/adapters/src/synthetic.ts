import { createHash } from 'node:crypto';
import { campaigns, PROGRAM_ID } from '../../core/src/campaigns';
import { usdToRaw } from '../../core/src/money';
import { validateTierPeriods } from '../../core/src/tier-periods';
import type {
  Campaign,
  CampaignResult,
  Cursor,
  InjectedCampaignGroundTruth,
  MarketPrice,
  RawEvent,
  SpendEvent,
  SpendSource,
  SyntheticDataset,
  Tier,
  TierEvent,
  TierPeriod,
  TierQualification,
} from '../../core/src/types';

const DAY_MS = 86_400_000;
const DEFAULT_START = new Date('2025-05-02T00:00:00.000Z');
const DEFAULT_END = new Date('2026-11-02T00:00:00.000Z');
const GENERATED_AT = new Date('2026-11-02T00:05:00.000Z');

interface Transition {
  at: Date;
  tier: Tier;
  qualifiedBy: TierQualification;
}

interface SyntheticAccount {
  address: `0x${string}`;
  joinedAt: Date;
  churnedAt: Date | null;
  transitions: Transition[];
}

export interface SyntheticOptions {
  seed?: string;
  startsAt?: Date;
  endsAt?: Date;
  accountCount?: number;
  utcOffsetHours?: number;
}

class Random {
  private state: number;

  constructor(seed: string) {
    this.state = hashSeed(seed);
  }

  next(): number {
    this.state |= 0;
    this.state = (this.state + 0x6d2b79f5) | 0;
    let value = Math.imul(this.state ^ (this.state >>> 15), 1 | this.state);
    value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value;
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
  }

  integer(min: number, maxExclusive: number): number {
    return Math.floor(this.next() * (maxExclusive - min)) + min;
  }

  chance(probability: number): boolean {
    return this.next() < probability;
  }

  normal(): number {
    const first = Math.max(this.next(), Number.EPSILON);
    const second = this.next();
    return Math.sqrt(-2 * Math.log(first)) * Math.cos(2 * Math.PI * second);
  }

  pick<T>(values: readonly T[]): T {
    const value = values[this.integer(0, values.length)];
    if (value === undefined) throw new Error('Cannot pick from an empty array');
    return value;
  }
}

function hashSeed(seed: string): number {
  let hash = 2_166_136_261;
  for (const character of seed) {
    hash ^= character.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 16_777_619);
  }
  return hash >>> 0;
}

function hashHex(input: string, length: number): string {
  const digest = createHash('sha256').update(input).digest('hex');
  return digest.repeat(Math.ceil(length / digest.length)).slice(0, length);
}

function address(seed: string, index: number): `0x${string}` {
  return `0x${hashHex(`${seed}:account:${index}`, 40)}`;
}

function transactionHash(seed: string, index: number): `0x${string}` {
  return `0x${hashHex(`${seed}:transaction:${index}`, 64)}`;
}

function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * DAY_MS);
}

function daysBetween(start: Date, end: Date): number {
  return Math.max(0, Math.ceil((end.getTime() - start.getTime()) / DAY_MS));
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function tierAt(account: SyntheticAccount, at: Date): Tier {
  let tier: Tier = 'core';
  for (const transition of account.transitions) {
    if (transition.at > at) break;
    tier = transition.tier;
  }
  return tier;
}

function isActive(account: SyntheticAccount, at: Date): boolean {
  return account.joinedAt <= at && (!account.churnedAt || account.churnedAt > at);
}

function normalizeTransitions(account: SyntheticAccount): void {
  account.transitions.sort((a, b) => a.at.getTime() - b.at.getTime());
  const unique: Transition[] = [];
  for (const transition of account.transitions) {
    const previous = unique.at(-1);
    if (previous?.at.getTime() === transition.at.getTime()) unique.pop();
    if (unique.at(-1)?.tier !== transition.tier) unique.push(transition);
  }
  account.transitions = unique;
}

function createAccounts(random: Random, seed: string, startsAt: Date, endsAt: Date, count: number): SyntheticAccount[] {
  const totalDays = daysBetween(startsAt, endsAt);
  const tiers: readonly Tier[] = ['core', 'core', 'core', 'core', 'core', 'core', 'luxe', 'luxe', 'pinnacle', 'vip'];
  const qualifications: readonly TierQualification[] = ['sethfi', 'liquid', 'points', 'paid'];
  const accounts: SyntheticAccount[] = [];
  for (let index = 0; index < count; index += 1) {
    const joinedAt = addDays(startsAt, random.integer(0, Math.max(1, totalDays - 45)));
    const initialTier = random.pick(tiers);
    const churnedAt = random.chance(0.18)
      ? addDays(joinedAt, random.integer(45, Math.max(46, Math.min(300, daysBetween(joinedAt, endsAt)))))
      : null;
    const transitions: Transition[] = [{ at: joinedAt, tier: initialTier, qualifiedBy: initialTier === 'core' ? 'unknown' : random.pick(qualifications) }];
    if (initialTier === 'core' && random.chance(0.3) && daysBetween(joinedAt, endsAt) > 60) {
      const at = addDays(joinedAt, random.integer(30, Math.max(31, daysBetween(joinedAt, endsAt) - 1)));
      transitions.push({ at, tier: random.chance(0.82) ? 'luxe' : 'pinnacle', qualifiedBy: random.pick(qualifications) });
    }
    accounts.push({ address: address(seed, index), joinedAt, churnedAt: churnedAt && churnedAt < endsAt ? churnedAt : null, transitions });
  }

  const iphone = campaigns.find((campaign) => campaign.id === 'etherfi-iphone18-preorder');
  if (!iphone) throw new Error('iPhone campaign missing from registry');
  const candidates = accounts.filter((account) => isActive(account, iphone.startsAt) && account.joinedAt < addDays(iphone.startsAt, -30) && tierAt(account, addDays(iphone.startsAt, -15)) === 'core').slice(0, 36);
  for (let index = 0; index < candidates.length; index += 1) {
    const account = candidates[index];
    if (!account) continue;
    account.transitions.push({
      at: addDays(iphone.startsAt, -14 + (index % 13)),
      tier: index % 8 === 0 ? 'pinnacle' : 'luxe',
      qualifiedBy: index % 3 === 0 ? 'liquid' : 'sethfi',
    });
    if (index % 3 === 0) {
      account.transitions.push({
        at: addDays(iphone.endsAt, 5 + (index % 23)),
        tier: 'core',
        qualifiedBy: 'unknown',
      });
    }
  }
  for (const account of accounts) normalizeTransitions(account);
  return accounts;
}

function createTierFacts(accounts: readonly SyntheticAccount[], seed: string): { periods: TierPeriod[]; events: TierEvent[] } {
  const periods: TierPeriod[] = [];
  const events: TierEvent[] = [];
  let transactionIndex = 800_000;
  let blockNumber = 126_000_000;
  for (const account of accounts) {
    account.transitions.forEach((transition, index) => {
      const next = account.transitions[index + 1];
      periods.push({
        programId: PROGRAM_ID,
        cardAccount: account.address,
        tier: transition.tier,
        validFrom: transition.at,
        validTo: next?.at ?? null,
        qualifiedBy: transition.qualifiedBy,
        sourceId: 'synthetic:tier-periods',
        provenance: 'demo',
      });
      if (index === 0) return;
      const previous = account.transitions[index - 1];
      if (!previous) return;
      const isDowngrade = transition.tier === 'core';
      const qualification = isDowngrade ? previous.qualifiedBy : transition.qualifiedBy;
      const affectedTier = isDowngrade ? previous.tier : transition.tier;
      const isLiquid = qualification === 'liquid';
      const amount = affectedTier === 'pinnacle' ? 150_000 : affectedTier === 'vip' ? 500_000 : 30_000;
      events.push({
        chainId: 10,
        txHash: transactionHash(seed, transactionIndex),
        logIndex: 0,
        blockNumber,
        blockTime: transition.at,
        programId: PROGRAM_ID,
        cardAccount: account.address,
        action: isDowngrade ? (isLiquid ? 'withdraw' : 'unstake') : (isLiquid ? 'deposit' : 'stake'),
        asset: isLiquid ? 'LIQUID' : 'ETHFI',
        amountRaw: usdToRaw(amount, 18),
        sourceId: 'synthetic:tier',
        provenance: 'demo',
        finalized: true,
      });
      transactionIndex += 1;
      blockNumber += 1;
    });
  }
  validateTierPeriods(periods);
  return { periods, events };
}

function chooseHour(random: Random, utcOffsetHours: number): number {
  const localHours = [7, 8, 9, 11, 12, 12, 13, 14, 17, 18, 18, 19, 20, 21, 22, 23];
  const local = random.pick(localHours);
  return (local - utcOffsetHours + 24) % 24;
}

function chooseCurrency(random: Random): 'USD' | 'EUR' | 'GBP' {
  const value = random.next();
  if (value < 0.9) return 'USD';
  if (value < 0.965) return 'EUR';
  return 'GBP';
}

function makeSpendEvent(input: {
  seed: string;
  index: number;
  blockNumber: number;
  time: Date;
  account: SyntheticAccount;
  amountUsd: number;
  sourceId: string;
  eventType?: 'spend' | 'cashback';
  currency?: 'USD' | 'EUR' | 'GBP';
}): SpendEvent {
  const currency = input.currency ?? 'USD';
  const amount = input.amountUsd.toFixed(4);
  return {
    chainId: 10,
    txHash: transactionHash(input.seed, input.index),
    logIndex: 0,
    blockNumber: input.blockNumber,
    blockTime: input.time,
    eventType: input.eventType ?? 'spend',
    programId: PROGRAM_ID,
    cardAccount: input.account.address,
    tokenSymbol: currency === 'USD' ? 'USDC' : currency === 'EUR' ? 'EURe' : 'GBPT',
    decimals: 6,
    amountRaw: usdToRaw(input.amountUsd),
    settlementCcy: currency,
    amountUsd: amount,
    priceSource: 'synthetic:fixed-fx',
    pricedAt: input.time,
    sourceId: input.sourceId,
    provenance: 'demo',
    finalized: true,
  };
}

function createBaselineSpend(random: Random, seed: string, startsAt: Date, endsAt: Date, accounts: readonly SyntheticAccount[], utcOffsetHours: number): { events: SpendEvent[]; nextIndex: number; nextBlock: number } {
  const events: SpendEvent[] = [];
  let transactionIndex = 0;
  let blockNumber = 120_000_000;
  for (let day = 0; day < daysBetween(startsAt, endsAt); day += 1) {
    const date = addDays(startsAt, day);
    const active = accounts.filter((account) => isActive(account, date));
    if (active.length === 0) continue;
    const weekend = [0, 6].includes(date.getUTCDay());
    const count = Math.round((42 + active.length * 0.075) * (weekend ? 0.82 : 1) * (0.88 + random.next() * 0.24));
    for (let index = 0; index < count; index += 1) {
      const account = random.pick(active);
      const time = new Date(date);
      time.setUTCHours(chooseHour(random, utcOffsetHours), random.integer(0, 60), random.integer(0, 60), 0);
      const amount = clamp(Math.exp(Math.log(58) + random.normal() * 0.93), 3, 7_500);
      events.push(makeSpendEvent({ seed, index: transactionIndex, blockNumber, time, account, amountUsd: amount, sourceId: 'synthetic:baseline', currency: chooseCurrency(random) }));
      transactionIndex += 1;
      blockNumber += random.integer(1, 4);
    }
  }
  return { events, nextIndex: transactionIndex, nextBlock: blockNumber };
}

function injectionSpec(campaign: Campaign): { perDay: number; minimum: number; maximum: number; costRatio: number } {
  if (campaign.id === 'etherfi-iphone18-preorder') return { perDay: 14, minimum: 1_000, maximum: 2_000, costRatio: 0.82 };
  if (campaign.id === 'etherfi-lunar-new-year-2026') return { perDay: 9, minimum: 88, maximum: 360, costRatio: 0.74 };
  return { perDay: 3, minimum: 24, maximum: 520, costRatio: 0.2 };
}

function createCampaignSpend(random: Random, seed: string, accounts: readonly SyntheticAccount[], startIndex: number, startBlock: number): { events: SpendEvent[]; groundTruth: InjectedCampaignGroundTruth[]; nextIndex: number; nextBlock: number } {
  const events: SpendEvent[] = [];
  const groundTruth: InjectedCampaignGroundTruth[] = [];
  let transactionIndex = startIndex;
  let blockNumber = startBlock;
  for (const campaign of campaigns) {
    const spec = injectionSpec(campaign);
    let volume = 0;
    let qualifying = 0;
    let incremental = 0;
    for (let day = 0; day < daysBetween(campaign.startsAt, campaign.endsAt); day += 1) {
      const date = addDays(campaign.startsAt, day);
      const eligible = accounts.filter((account) => isActive(account, date) && campaign.eligibleTiers.includes(tierAt(account, date)));
      if (eligible.length === 0) continue;
      for (let index = 0; index < spec.perDay; index += 1) {
        const account = random.pick(eligible);
        const time = new Date(date.getTime() + random.integer(0, 86_400) * 1_000);
        const amount = spec.minimum + random.next() * (spec.maximum - spec.minimum);
        events.push(makeSpendEvent({ seed, index: transactionIndex, blockNumber, time, account, amountUsd: amount, sourceId: `synthetic:campaign:${campaign.id}` }));
        transactionIndex += 1;
        blockNumber += random.integer(1, 4);
        volume += amount;
        incremental += 1;
        if (!campaign.signature.minTicketUsd || amount >= campaign.signature.minTicketUsd) qualifying += 1;
      }
    }
    const statedBudget = campaign.statedBudgetUsd ?? volume * spec.costRatio;
    const cashbackCost = Math.min(statedBudget, statedBudget * spec.costRatio);
    const payoutAt = campaign.payoutAt ?? addDays(campaign.endsAt, 14);
    const recipients = accounts.filter((account) => isActive(account, campaign.endsAt) && campaign.eligibleTiers.includes(tierAt(account, campaign.endsAt))).slice(0, 20);
    const shares = Math.max(1, recipients.length);
    recipients.forEach((account, index) => {
      const isLast = index === recipients.length - 1;
      const distributed = isLast ? cashbackCost - (cashbackCost / shares) * (shares - 1) : cashbackCost / shares;
      events.push(makeSpendEvent({ seed, index: transactionIndex, blockNumber, time: new Date(payoutAt.getTime() + index * 60_000), account, amountUsd: distributed, sourceId: `synthetic:cashback:${campaign.id}`, eventType: 'cashback' }));
      transactionIndex += 1;
      blockNumber += 1;
    });
    groundTruth.push({
      campaignId: campaign.id,
      incrementalTransactions: incremental,
      incrementalVolumeUsd: volume.toFixed(4),
      qualifyingSignatureTransactions: qualifying,
      cashbackCostUsd: cashbackCost.toFixed(4),
    });
  }
  return { events, groundTruth, nextIndex: transactionIndex, nextBlock: blockNumber };
}

function createMarketSeries(random: Random, startsAt: Date, endsAt: Date): MarketPrice[] {
  const prices: MarketPrice[] = [];
  let btc = 62_000;
  let ethfi = 1.14;
  for (let day = 0; day < daysBetween(startsAt, endsAt); day += 1) {
    const observedAt = addDays(startsAt, day);
    const marketReturn = random.normal() * 0.012;
    const announcementEffect = campaigns.some((campaign) => campaign.announcedAt && Math.abs(campaign.announcedAt.getTime() - observedAt.getTime()) < DAY_MS) ? 0.045 : 0;
    btc = Math.max(12_000, btc * (1 + marketReturn));
    ethfi = Math.max(0.08, ethfi * (1 + marketReturn * 1.35 + random.normal() * 0.018 + announcementEffect));
    prices.push({ sourceId: 'synthetic:market', symbol: 'BTC', observedAt, priceUsd: btc.toFixed(10), volumeUsd: (18_000_000_000 * (0.72 + random.next() * 0.56)).toFixed(4), provenance: 'demo' });
    prices.push({ sourceId: 'synthetic:market', symbol: 'ETHFI', observedAt, priceUsd: ethfi.toFixed(10), volumeUsd: (12_000_000 * (0.6 + random.next() * 0.9 + announcementEffect * 8)).toFixed(4), provenance: 'demo' });
  }
  return prices;
}

function createCampaignResults(groundTruth: readonly InjectedCampaignGroundTruth[]): CampaignResult[] {
  const results: CampaignResult[] = [];
  for (const truth of groundTruth) {
    const campaign = campaigns.find((candidate) => candidate.id === truth.campaignId);
    if (!campaign) continue;
    const computedAt = campaign.payoutAt ?? campaign.endsAt;
    results.push(
      { campaignId: truth.campaignId, metric: 'injected_incremental_transactions', value: String(truth.incrementalTransactions), ciLow: null, ciHigh: null, provenance: 'demo', methodNote: 'Known synthetic ground truth. This is a test fixture, not an estimate from real activity.', computedAt },
      { campaignId: truth.campaignId, metric: 'injected_incremental_volume_usd', value: truth.incrementalVolumeUsd, ciLow: null, ciHigh: null, provenance: 'demo', methodNote: 'Known synthetic ground truth, denominated in derived USD.', computedAt },
      { campaignId: truth.campaignId, metric: 'signature_transactions', value: String(truth.qualifyingSignatureTransactions), ciLow: null, ciHigh: null, provenance: 'demo', methodNote: campaign.signature.note, computedAt },
      { campaignId: truth.campaignId, metric: 'injected_cashback_cost_usd', value: truth.cashbackCostUsd, ciLow: null, ciHigh: null, provenance: 'demo', methodNote: 'Known synthetic cashback ground truth used to verify the measured cost pipeline.', computedAt },
    );
  }
  return results;
}

export function generateSyntheticDataset(options: SyntheticOptions = {}): SyntheticDataset {
  const seed = options.seed ?? 'cardtape-v0.1';
  const startsAt = options.startsAt ?? DEFAULT_START;
  const endsAt = options.endsAt ?? DEFAULT_END;
  if (endsAt <= startsAt) throw new Error('Synthetic history must end after it starts');
  const random = new Random(seed);
  const accounts = createAccounts(random, seed, startsAt, endsAt, options.accountCount ?? 420);
  const tierFacts = createTierFacts(accounts, seed);
  const baseline = createBaselineSpend(random, seed, startsAt, endsAt, accounts, options.utcOffsetHours ?? 8);
  const injected = createCampaignSpend(random, seed, accounts, baseline.nextIndex, baseline.nextBlock);
  const spendEvents = [...baseline.events, ...injected.events].sort((a, b) => a.blockTime.getTime() - b.blockTime.getTime() || a.blockNumber - b.blockNumber);
  return {
    seed,
    generatedAt: GENERATED_AT,
    startsAt,
    endsAt,
    spendEvents,
    tierPeriods: tierFacts.periods,
    tierEvents: tierFacts.events,
    marketPrices: createMarketSeries(random, startsAt, endsAt),
    campaignResults: createCampaignResults(injected.groundTruth),
    groundTruth: injected.groundTruth,
  };
}

export function fingerprintSyntheticDataset(dataset: SyntheticDataset): string {
  return createHash('sha256').update(JSON.stringify(dataset)).digest('hex');
}

function isSpendEvent(value: unknown): value is SpendEvent {
  if (!value || typeof value !== 'object') return false;
  return 'chainId' in value && 'txHash' in value && 'logIndex' in value && 'amountRaw' in value;
}

export class SyntheticSpendSource implements SpendSource {
  readonly id = 'synthetic';
  readonly kind = 'demo' as const;
  private readonly dataset: SyntheticDataset;

  constructor(options: SyntheticOptions = {}) {
    this.dataset = generateSyntheticDataset(options);
  }

  async fetch(cursor: Cursor, limit: number): Promise<{ events: RawEvent[]; cursor: Cursor }> {
    const selected = this.dataset.spendEvents.filter((event) => event.blockNumber > cursor.blockNumber).slice(0, limit);
    const last = selected.at(-1);
    return {
      events: selected.map((event) => ({ payload: event })),
      cursor: { blockNumber: last?.blockNumber ?? cursor.blockNumber, blockHash: last ? `0x${hashHex(last.txHash, 64)}` : cursor.blockHash },
    };
  }

  normalize(raw: RawEvent): SpendEvent[] {
    return isSpendEvent(raw.payload) ? [raw.payload] : [];
  }
}

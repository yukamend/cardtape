import type { Campaign, SpendEvent, Tier } from './types';

export const TAPE_RING_CAPACITY = 500;
export const TAPE_INSERTS_PER_FRAME = 50;

export interface TapeEvent {
  id: string;
  chainId: number;
  txHash: `0x${string}`;
  logIndex: number;
  blockNumber: number;
  blockTime: string;
  eventType: SpendEvent['eventType'];
  programId: string;
  cardAccount: `0x${string}`;
  tier: Tier | null;
  tokenSymbol: string;
  settlementCcy: SpendEvent['settlementCcy'];
  amountUsd: string | null;
  sourceId: string;
  provenance: SpendEvent['provenance'];
  finalized: boolean;
  campaignWindowIds: string[];
  signatureCampaignIds: string[];
}

export type TapeMessage =
  | { type: 'snapshot'; events: TapeEvent[]; asOf: string }
  | { type: 'event'; event: TapeEvent }
  | { type: 'status'; source: 'postgres'; mode: 'live' | 'demo-replay'; clients: number };

export function tapeEventId(event: Pick<SpendEvent, 'chainId' | 'txHash' | 'logIndex'>): string {
  return `${event.chainId}:${event.txHash}:${event.logIndex}`;
}

function isInWindow(event: SpendEvent, campaign: Campaign): boolean {
  return event.programId === campaign.programId
    && event.blockTime >= campaign.startsAt
    && event.blockTime < campaign.endsAt;
}

function matchesSignature(event: SpendEvent, campaign: Campaign, tier: Tier | null): boolean {
  if (event.eventType !== 'spend' || !isInWindow(event, campaign) || !tier) return false;
  if (!campaign.eligibleTiers.includes(tier)) return false;
  const { minTicketUsd, maxTicketUsd } = campaign.signature;
  if (minTicketUsd === undefined && maxTicketUsd === undefined) return false;
  if (event.amountUsd === null) return false;
  const amount = Number(event.amountUsd);
  if (!Number.isFinite(amount)) return false;
  return (minTicketUsd === undefined || amount >= minTicketUsd)
    && (maxTicketUsd === undefined || amount <= maxTicketUsd);
}

export function classifyTapeEvent(
  event: SpendEvent,
  tier: Tier | null,
  registry: readonly Campaign[],
): TapeEvent {
  const campaignWindowIds = registry.filter((campaign) => isInWindow(event, campaign)).map((campaign) => campaign.id);
  const signatureCampaignIds = registry.filter((campaign) => matchesSignature(event, campaign, tier)).map((campaign) => campaign.id);
  return {
    id: tapeEventId(event),
    chainId: event.chainId,
    txHash: event.txHash,
    logIndex: event.logIndex,
    blockNumber: event.blockNumber,
    blockTime: event.blockTime.toISOString(),
    eventType: event.eventType,
    programId: event.programId,
    cardAccount: event.cardAccount,
    tier,
    tokenSymbol: event.tokenSymbol,
    settlementCcy: event.settlementCcy,
    amountUsd: event.amountUsd,
    sourceId: event.sourceId,
    provenance: event.provenance,
    finalized: event.finalized,
    campaignWindowIds,
    signatureCampaignIds,
  };
}

/**
 * Ingests every event, then exposes a fixed-size newest-first view. Rendering can
 * drain in small frame-sized batches without losing arrivals during a burst.
 */
export class TapeFrameBuffer {
  private readonly capacity: number;
  private readonly queued: TapeEvent[] = [];
  private rows: TapeEvent[] = [];
  private readonly knownIds = new Set<string>();
  received = 0;
  duplicates = 0;
  evicted = 0;

  constructor(capacity = TAPE_RING_CAPACITY) {
    this.capacity = capacity;
  }

  replace(events: readonly TapeEvent[]): void {
    this.queued.length = 0;
    this.knownIds.clear();
    this.received = 0;
    this.duplicates = 0;
    this.evicted = 0;
    this.rows = events.slice(0, this.capacity);
    for (const event of this.rows) this.knownIds.add(event.id);
  }

  enqueue(event: TapeEvent): boolean {
    this.received += 1;
    if (this.knownIds.has(event.id)) {
      this.duplicates += 1;
      return false;
    }
    this.knownIds.add(event.id);
    this.queued.push(event);
    return true;
  }

  enqueueMany(events: readonly TapeEvent[]): number {
    let accepted = 0;
    for (const event of events) if (this.enqueue(event)) accepted += 1;
    return accepted;
  }

  flush(maximum = TAPE_INSERTS_PER_FRAME): TapeEvent[] {
    if (maximum <= 0 || this.queued.length === 0) return this.snapshot();
    const batch = this.queued.splice(0, maximum).reverse();
    this.rows = [...batch, ...this.rows];
    if (this.rows.length > this.capacity) {
      const removed = this.rows.splice(this.capacity);
      this.evicted += removed.length;
      for (const event of removed) this.knownIds.delete(event.id);
    }
    return this.snapshot();
  }

  snapshot(): TapeEvent[] {
    return [...this.rows];
  }

  get pending(): number {
    return this.queued.length;
  }
}

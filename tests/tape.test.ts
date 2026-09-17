import { describe, expect, it } from 'vitest';
import { campaigns } from '../packages/core/src/campaigns';
import {
  classifyTapeEvent,
  TapeFrameBuffer,
  TAPE_INSERTS_PER_FRAME,
  type TapeEvent,
} from '../packages/core/src/tape';
import type { SpendEvent, Tier } from '../packages/core/src/types';

function spend(overrides: Partial<SpendEvent> = {}): SpendEvent {
  return {
    chainId: 10,
    txHash: `0x${'1'.repeat(64)}`,
    logIndex: 0,
    blockNumber: 1,
    blockTime: new Date('2026-09-17T12:00:00.000Z'),
    eventType: 'spend',
    programId: 'etherfi-cash',
    cardAccount: `0x${'2'.repeat(40)}`,
    tokenSymbol: 'USDC',
    decimals: 6,
    amountRaw: '1284500000',
    settlementCcy: 'USD',
    amountUsd: '1284.5000',
    priceSource: 'synthetic:fixed-fx',
    pricedAt: new Date('2026-09-17T12:00:00.000Z'),
    sourceId: 'synthetic:test',
    provenance: 'demo',
    finalized: true,
    ...overrides,
  };
}

function classified(index: number, tier: Tier = 'luxe'): TapeEvent {
  const hex = index.toString(16).padStart(64, '0');
  return classifyTapeEvent(spend({ txHash: `0x${hex}`, blockNumber: index }), tier, campaigns);
}

describe('tape classification', () => {
  it('marks a qualifying eligible settlement inside the campaign window', () => {
    const event = classifyTapeEvent(spend(), 'luxe', campaigns);
    expect(event.campaignWindowIds).toContain('etherfi-iphone18-preorder');
    expect(event.signatureCampaignIds).toContain('etherfi-iphone18-preorder');
  });

  it('shades the campaign window without marking an ineligible signature', () => {
    const event = classifyTapeEvent(spend(), 'core', campaigns);
    expect(event.campaignWindowIds).toContain('etherfi-iphone18-preorder');
    expect(event.signatureCampaignIds).not.toContain('etherfi-iphone18-preorder');
  });
});

describe('tape render backpressure', () => {
  it('ingests 500 events in one second without dropping a frame payload', () => {
    const buffer = new TapeFrameBuffer(500);
    const injected = Array.from({ length: 500 }, (_, index) => classified(index + 1));
    expect(buffer.enqueueMany(injected)).toBe(500);

    let frames = 0;
    while (buffer.pending > 0) {
      buffer.flush(TAPE_INSERTS_PER_FRAME);
      frames += 1;
    }

    const rendered = buffer.snapshot();
    expect(frames).toBe(10);
    expect(buffer.received).toBe(500);
    expect(buffer.duplicates).toBe(0);
    expect(buffer.evicted).toBe(0);
    expect(rendered).toHaveLength(500);
    expect(new Set(rendered.map((event) => event.id)).size).toBe(500);
    expect(rendered[0]?.blockNumber).toBe(500);
  });
});

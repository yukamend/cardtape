import { describe, expect, it } from 'vitest';
import { generateSyntheticDataset } from '../packages/adapters/src/synthetic';
import { deduplicateSpendEvents, spendEventKey } from '../packages/db/src/repository';

describe('idempotent spend-event identity', () => {
  it('uses the chain, transaction hash, and log index as the immutable key', () => {
    const [event] = generateSyntheticDataset({ seed: 'identity', accountCount: 40 }).spendEvents;
    if (!event) throw new Error('Synthetic fixture did not produce a spend event');
    expect(spendEventKey(event)).toBe(`${event.chainId}:${event.txHash}:${event.logIndex}`);
  });

  it('collapses repeated adapter output without changing the fact', () => {
    const events = generateSyntheticDataset({ seed: 'dedupe', accountCount: 40 }).spendEvents.slice(0, 50);
    const deduplicated = deduplicateSpendEvents([...events, ...events]);

    expect(deduplicated).toHaveLength(events.length);
    expect(deduplicated).toEqual(events);
  });
});

import { describe, expect, it } from 'vitest';
import { generateSyntheticDataset, fingerprintSyntheticDataset, SyntheticSpendSource } from '../packages/adapters/src/synthetic';

describe('synthetic adapter', () => {
  it('is deterministic for the same seed and changes for a different seed', () => {
    const first = generateSyntheticDataset({ seed: 'repeatable', accountCount: 120 });
    const second = generateSyntheticDataset({ seed: 'repeatable', accountCount: 120 });
    const different = generateSyntheticDataset({ seed: 'different', accountCount: 120 });

    expect(fingerprintSyntheticDataset(first)).toBe(fingerprintSyntheticDataset(second));
    expect(fingerprintSyntheticDataset(first)).not.toBe(fingerprintSyntheticDataset(different));
  });

  it('covers 18 months and exposes known campaign ground truth', () => {
    const dataset = generateSyntheticDataset({ seed: 'coverage', accountCount: 180 });
    const historyDays = (dataset.endsAt.getTime() - dataset.startsAt.getTime()) / 86_400_000;

    expect(historyDays).toBeGreaterThanOrEqual(548);
    expect(dataset.spendEvents.length).toBeGreaterThan(20_000);
    expect(dataset.groundTruth).toHaveLength(3);
    expect(dataset.groundTruth.every((truth) => truth.incrementalTransactions > 0)).toBe(true);
    expect(dataset.groundTruth.find((truth) => truth.campaignId === 'etherfi-iphone18-preorder')?.qualifyingSignatureTransactions).toBeGreaterThan(0);
  });

  it('paginates with a durable block cursor and normalizes raw events', async () => {
    const source = new SyntheticSpendSource({ seed: 'cursor', accountCount: 80 });
    const first = await source.fetch({ blockNumber: 0, blockHash: null }, 25);
    const second = await source.fetch(first.cursor, 25);

    expect(first.events).toHaveLength(25);
    expect(second.events).toHaveLength(25);
    expect(second.cursor.blockNumber).toBeGreaterThan(first.cursor.blockNumber);
    expect(source.normalize(first.events[0] ?? { payload: null })).toHaveLength(1);
  });
});

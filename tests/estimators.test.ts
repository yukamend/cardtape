import { describe, expect, it } from 'vitest';
import { generateSyntheticDataset } from '../packages/adapters/src/synthetic';
import { campaigns, getCampaign } from '../packages/core/src/campaigns';
import { estimateDifferenceInDifferences } from '../packages/core/src/estimators/did';
import { estimateTokenEventStudy } from '../packages/core/src/estimators/event-study';
import { estimateAllCampaigns } from '../packages/core/src/estimators/pipeline';
import { estimateSignatureMatch } from '../packages/core/src/estimators/signature';
import { estimatePersistence } from '../packages/core/src/estimators/survival';
import type { Campaign } from '../packages/core/src/types';

const dataset = generateSyntheticDataset({ seed: 'cardtape-v0.1' });
const iphone = getCampaign('etherfi-iphone18-preorder');

describe('campaign estimators', () => {
  it('recovers the injected iPhone campaign volume inside the clustered interval', () => {
    const estimate = estimateDifferenceInDifferences(dataset.spendEvents, dataset.tierPeriods, iphone);
    const truth = dataset.groundTruth.find((candidate) => candidate.campaignId === iphone.id);
    if (!truth || estimate.ciLow === null || estimate.ciHigh === null) throw new Error('Missing estimate or ground truth');

    expect(estimate.estimable).toBe(true);
    expect(estimate.clusters).toBeGreaterThan(30);
    expect(estimate.ciLow).toBeLessThanOrEqual(Number(truth.incrementalVolumeUsd));
    expect(estimate.ciHigh).toBeGreaterThanOrEqual(Number(truth.incrementalVolumeUsd));
  });

  it('returns an interval containing zero in a campaign-free placebo window', () => {
    const placebo: Campaign = {
      ...iphone,
      id: 'iphone-placebo',
      startsAt: new Date('2026-08-01T00:00:00.000Z'),
      endsAt: new Date('2026-08-08T00:00:00.000Z'),
    };
    const estimate = estimateDifferenceInDifferences(dataset.spendEvents, dataset.tierPeriods, placebo);
    if (estimate.ciLow === null || estimate.ciHigh === null) throw new Error('Placebo was not estimable');

    expect(estimate.ciLow).toBeLessThanOrEqual(0);
    expect(estimate.ciHigh).toBeGreaterThanOrEqual(0);
  });

  it('detects the incentivized ticket-size signature', () => {
    const estimate = estimateSignatureMatch(dataset.spendEvents, dataset.tierPeriods, iphone);

    expect(estimate.eligibleDuring.matchingTransactions).toBeGreaterThan(estimate.eligibleBaseline.matchingTransactions / 4);
    expect(estimate.normalizedEligibleCountLift).toBeGreaterThan(0);
    expect(estimate.shareDifference).toBeGreaterThan(0);
    expect(estimate.methodNote).toMatch(/not identifiable on-chain/i);
  });

  it('produces observable retention points and an unstake cohort', () => {
    const estimate = estimatePersistence(dataset.spendEvents, dataset.tierEvents, iphone);

    expect(estimate.cohortAccounts.length).toBeGreaterThan(0);
    expect(estimate.campaign.find((point) => point.week === 4)?.observable).toBe(true);
    expect(estimate.stakerCohortSize).toBeGreaterThan(0);
    expect(estimate.unstakedWithin30Days).toBeGreaterThan(0);
    expect(estimate.unstakeShare).toBeGreaterThan(0);
  });

  it('estimates beta and a finite cumulative abnormal return series', () => {
    const estimate = estimateTokenEventStudy(dataset.marketPrices, iphone);

    expect(estimate.estimable).toBe(true);
    expect(estimate.beta).not.toBeNull();
    expect(estimate.points.length).toBeGreaterThanOrEqual(14);
    expect(estimate.points.every((point) => Number.isFinite(point.cumulativeAbnormalReturn))).toBe(true);
  });

  it('materializes attributed, reproducible result rows for every campaign', () => {
    const results = estimateAllCampaigns({
      spendEvents: dataset.spendEvents,
      tierPeriods: dataset.tierPeriods,
      tierEvents: dataset.tierEvents,
      marketPrices: dataset.marketPrices,
      computedAt: dataset.generatedAt,
    }, campaigns);

    expect(results).toHaveLength(campaigns.length * 14);
    expect(results.every((result) => result.provenance === 'demo')).toBe(true);
    expect(results.every((result) => result.methodNote.length > 20)).toBe(true);
  });
});

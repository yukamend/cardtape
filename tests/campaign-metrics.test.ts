import { afterEach, describe, expect, it, vi } from 'vitest';
import { getCampaignMetrics } from '../packages/adapters/src/campaign-metrics';
import { dataSources, getCampaignsForNeobank, neobanks, type CampaignImpact } from '../packages/core/src/neobanks';
import { isPublishedSnapshot, snapshotImpact, type PublishedSnapshot } from '../packages/core/src/published-snapshot';

const period = { start: '2026-09-12T13:00:00.000Z', end: '2026-09-19T03:59:00.000Z' };
const baseline = { start: '2026-08-29T13:00:00.000Z', end: '2026-09-12T12:59:59.999Z' };
const sampleImpact: CampaignImpact = {
  neobankId: 'etherfi-cash', campaignId: 'etherfi-iphone18-preorder', verdict: 'insufficient',
  conclusion: 'No measured readout', campaignPeriod: period, baselinePeriod: baseline,
  metrics: [], trend: [], limitations: [],
};

afterEach(() => vi.unstubAllGlobals());

describe('neobank campaign metrics', () => {
  it('organizes campaigns under neobanks instead of chains', () => {
    expect(neobanks.map((neobank) => neobank.id)).toEqual(['etherfi-cash', 'plasma-one']);
    expect(getCampaignsForNeobank('etherfi-cash').map((campaign) => campaign.id)).toContain('etherfi-iphone18-preorder');
    expect(getCampaignsForNeobank('plasma-one')).toHaveLength(1);
    expect(dataSources.some((source) => source.networks.includes('Plasma'))).toBe(true);
  });

  it('loads the published campaign baseline from the static snapshot', async () => {
    const snapshot: PublishedSnapshot = {
      version: 1, generatedAt: '2026-09-23T00:00:00.000Z',
      optimism: { blockNumber: 157000000, indexedAt: '2026-09-23T00:00:00.000Z', tierBlockNumber: null, tiersIndexedAt: null },
      tape: [], campaigns: { 'etherfi-iphone18-preorder': { '14': sampleImpact } },
    };
    const fetcher = vi.fn().mockResolvedValue({ ok: true, json: async () => snapshot });
    vi.stubGlobal('fetch', fetcher);
    const result = await getCampaignMetrics({
      neobankId: 'etherfi-cash',
      campaignId: 'etherfi-iphone18-preorder',
      campaignPeriod: period, baselinePeriod: baseline,
    });
    expect(result.campaignId).toBe('etherfi-iphone18-preorder');
    expect(fetcher).toHaveBeenCalledWith('/snapshots/current.json', { cache: 'no-store' });
  });

  it('does not fall back to demo metrics when the live source is unavailable', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 503 }));
    await expect(getCampaignMetrics({ neobankId: 'plasma-one', campaignId: 'plasma-one-platinum-locks', campaignPeriod: period, baselinePeriod: baseline })).rejects.toThrow(/503/);
    expect(dataSources.find((source) => source.id === 'plasma-one-lock-vault')?.kind).toBe('cached');
  });

  it('rejects a campaign routed through the wrong neobank adapter', async () => {
    await expect(getCampaignMetrics({ neobankId: 'plasma-one', campaignId: 'etherfi-iphone18-preorder', campaignPeriod: period, baselinePeriod: baseline })).rejects.toThrow(/does not belong/);
  });

  it('selects a published baseline without replacing missing values with demo data', () => {
    const impact: CampaignImpact = { ...sampleImpact, neobankId: 'plasma-one', campaignId: 'plasma-one-platinum-locks' };
    const snapshot: PublishedSnapshot = {
      version: 1, generatedAt: '2026-09-23T00:00:00.000Z',
      optimism: { blockNumber: 157000000, indexedAt: '2026-09-23T00:00:00.000Z', tierBlockNumber: null, tiersIndexedAt: null },
      tape: [], campaigns: { 'plasma-one-platinum-locks': { '7': impact } },
    };
    expect(isPublishedSnapshot(snapshot)).toBe(true);
    expect(snapshotImpact(snapshot, 'plasma-one-platinum-locks', 7)).toBe(impact);
    expect(snapshotImpact(snapshot, 'plasma-one-platinum-locks', 30)).toBeNull();
    expect(isPublishedSnapshot({ ...snapshot, version: 2 })).toBe(false);
  });
});

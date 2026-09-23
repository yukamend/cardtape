import type { CampaignImpact } from '../../core/src/neobanks';
import { getNeobankCampaign } from '../../core/src/neobanks';
import { isPublishedSnapshot, snapshotImpact } from '../../core/src/published-snapshot';

export interface CampaignMetricsQuery {
  neobankId: string;
  campaignId: string;
  campaignPeriod: { start: string; end: string };
  baselinePeriod: { start: string; end: string };
}

export async function getCampaignMetrics(query: CampaignMetricsQuery): Promise<CampaignImpact> {
  const campaign = getNeobankCampaign(query.campaignId);
  if (campaign.neobankId !== query.neobankId) {
    throw new Error(`Campaign ${query.campaignId} does not belong to ${query.neobankId}`);
  }
  const baselineDays = Math.round((Date.parse(query.campaignPeriod.start) - Date.parse(query.baselinePeriod.start)) / 86_400_000);
  if (!Number.isSafeInteger(baselineDays) || baselineDays < 1) throw new Error('Invalid campaign baseline');
  const response = await fetch('/snapshots/current.json', { cache: 'no-store' });
  if (!response.ok) throw new Error(`Published snapshot returned ${response.status}`);
  const snapshot: unknown = await response.json();
  if (!isPublishedSnapshot(snapshot)) throw new Error('Invalid published snapshot');
  const impact = snapshotImpact(snapshot, query.campaignId, baselineDays);
  if (!impact) throw new Error(`No published readout for ${query.campaignId} with a ${baselineDays}-day baseline`);
  return impact;
}

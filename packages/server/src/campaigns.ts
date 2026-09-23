import type { Pool } from 'pg';
import { getNeobankCampaign } from '../../core/src/neobanks';
import { getPlasmaImpact } from '../../adapters/src/plasma';
import type { CampaignMetricsQuery } from '../../adapters/src/campaign-metrics';
import { loadEtherfiImpact } from '../../db/src/campaign-impact';

const DAY = 86_400_000;

export class CampaignRequestError extends Error {}

export function parseCampaignQuery(campaignId: string, parameters: URLSearchParams): CampaignMetricsQuery {
  let campaign;
  try {
    campaign = getNeobankCampaign(campaignId);
  } catch {
    throw new CampaignRequestError('Unknown campaign');
  }
  const required = (name: string) => {
    const value = parameters.get(name);
    if (!value || !Number.isFinite(new Date(value).getTime())) throw new CampaignRequestError(`Invalid ${name}`);
    return value;
  };
  const query: CampaignMetricsQuery = {
    neobankId: campaign.neobankId,
    campaignId,
    campaignPeriod: { start: required('campaignStart'), end: required('campaignEnd') },
    baselinePeriod: { start: required('baselineStart'), end: required('baselineEnd') },
  };
  if (campaign.neobankId === 'etherfi-cash') {
    const start = new Date(query.campaignPeriod.start).getTime();
    const baselineStart = new Date(query.baselinePeriod.start).getTime();
    const baselineEnd = new Date(query.baselinePeriod.end).getTime();
    const days = (start - baselineStart) / DAY;
    const allowedDays = campaignId === 'etherfi-cash-live' ? [1] : [7, 14, 30];
    if (baselineEnd !== start - 1 || !allowedDays.includes(days)) throw new CampaignRequestError('Invalid baseline window');
  }
  return query;
}

export function getCampaignImpact(pool: Pool, query: CampaignMetricsQuery) {
  return query.neobankId === 'plasma-one'
    ? getPlasmaImpact(query)
    : loadEtherfiImpact(pool, query.campaignId, query.campaignPeriod, query.baselinePeriod);
}

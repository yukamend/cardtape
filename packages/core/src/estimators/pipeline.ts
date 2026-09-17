import type { Campaign, CampaignResult, MarketPrice, MetricProvenance, SpendEvent, TierEvent, TierPeriod } from '../types';
import { estimateDifferenceInDifferences } from './did';
import { estimateTokenEventStudy } from './event-study';
import { estimateSignatureMatch } from './signature';
import { estimatePersistence } from './survival';

export interface EstimatorInputs {
  spendEvents: readonly SpendEvent[];
  tierPeriods: readonly TierPeriod[];
  tierEvents: readonly TierEvent[];
  marketPrices: readonly MarketPrice[];
  computedAt: Date;
}

function provenance(inputs: EstimatorInputs, nonDemo: Exclude<MetricProvenance, 'demo'>): MetricProvenance {
  const facts = [...inputs.spendEvents, ...inputs.tierEvents, ...inputs.marketPrices];
  return facts.length > 0 && facts.every((fact) => fact.provenance === 'demo') ? 'demo' : nonDemo;
}

function numeric(value: number | null): string | null {
  return value === null || !Number.isFinite(value) ? null : value.toFixed(4);
}

function result(input: {
  campaignId: string;
  metric: string;
  value: number | null;
  ciLow?: number | null;
  ciHigh?: number | null;
  provenance: MetricProvenance;
  methodNote: string;
  computedAt: Date;
}): CampaignResult {
  return {
    campaignId: input.campaignId,
    metric: input.metric,
    value: numeric(input.value),
    ciLow: numeric(input.ciLow ?? null),
    ciHigh: numeric(input.ciHigh ?? null),
    provenance: input.provenance,
    methodNote: input.methodNote,
    computedAt: input.computedAt,
  };
}

export function estimateCampaign(inputs: EstimatorInputs, campaign: Campaign): CampaignResult[] {
  const volume = estimateDifferenceInDifferences(inputs.spendEvents, inputs.tierPeriods, campaign, 'volume');
  const transactions = estimateDifferenceInDifferences(inputs.spendEvents, inputs.tierPeriods, campaign, 'transactions');
  const activeCards = estimateDifferenceInDifferences(inputs.spendEvents, inputs.tierPeriods, campaign, 'active_cards');
  const signature = estimateSignatureMatch(inputs.spendEvents, inputs.tierPeriods, campaign);
  const persistence = estimatePersistence(inputs.spendEvents, inputs.tierEvents, campaign);
  const token = estimateTokenEventStudy(inputs.marketPrices, campaign);
  const cashback = inputs.spendEvents.filter((event) => event.eventType === 'cashback' && event.sourceId.endsWith(campaign.id) && event.amountUsd !== null).reduce((sum, event) => sum + Number(event.amountUsd), 0);
  const transactionEstimate = transactions.totalIncremental && transactions.totalIncremental > 0 ? transactions.totalIncremental : null;
  const newCards = persistence.cohortAccounts.length;
  const rows: CampaignResult[] = [
    result({ campaignId: campaign.id, metric: 'did_incremental_volume_usd', value: volume.totalIncremental, ciLow: volume.ciLow, ciHigh: volume.ciHigh, provenance: provenance(inputs, 'estimated'), methodNote: volume.reason ?? `Difference-in-differences on account-day USD settlement volume with standard errors clustered by card account. Parallel-trends slope difference: ${numeric(volume.pretrendSlopeDifference)}. ${campaign.methodNote}`, computedAt: inputs.computedAt }),
    result({ campaignId: campaign.id, metric: 'did_incremental_transactions', value: transactions.totalIncremental, ciLow: transactions.ciLow, ciHigh: transactions.ciHigh, provenance: provenance(inputs, 'estimated'), methodNote: transactions.reason ?? `Difference-in-differences on account-day transaction count with standard errors clustered by card account. ${campaign.methodNote}`, computedAt: inputs.computedAt }),
    result({ campaignId: campaign.id, metric: 'did_incremental_active_card_days', value: activeCards.totalIncremental, ciLow: activeCards.ciLow, ciHigh: activeCards.ciHigh, provenance: provenance(inputs, 'estimated'), methodNote: activeCards.reason ?? `Difference-in-differences on account-day activity with standard errors clustered by card account. ${campaign.methodNote}`, computedAt: inputs.computedAt }),
    result({ campaignId: campaign.id, metric: 'signature_matching_transactions', value: signature.eligibleDuring.matchingTransactions, provenance: provenance(inputs, 'inferred'), methodNote: signature.methodNote, computedAt: inputs.computedAt }),
    result({ campaignId: campaign.id, metric: 'signature_share_lift', value: signature.shareDifference, ciLow: signature.shareDifferenceCiLow, ciHigh: signature.shareDifferenceCiHigh, provenance: provenance(inputs, 'inferred'), methodNote: `Difference in qualifying-ticket share between the campaign window and 28-day eligible-tier baseline. ${signature.methodNote}`, computedAt: inputs.computedAt }),
    result({ campaignId: campaign.id, metric: 'acquired_or_reactivated_cards', value: newCards, provenance: provenance(inputs, 'estimated'), methodNote: 'Accounts whose first settlement occurred in the window or whose prior inactivity lasted at least 28 days.', computedAt: inputs.computedAt }),
    result({ campaignId: campaign.id, metric: 'cashback_cost_usd', value: cashback, provenance: provenance(inputs, 'measured'), methodNote: 'Sum of campaign-linked cashback settlement events. Synthetic sources carry the campaign id explicitly; live attribution requires a reviewed reward-transfer rule.', computedAt: inputs.computedAt }),
    result({ campaignId: campaign.id, metric: 'cost_per_incremental_transaction_usd', value: transactionEstimate === null ? null : cashback / transactionEstimate, provenance: provenance(inputs, 'estimated'), methodNote: transactionEstimate === null ? 'Unavailable because incremental transactions are not estimable or are not positive.' : 'Measured cashback cost divided by the difference-in-differences estimate of incremental transactions.', computedAt: inputs.computedAt }),
    result({ campaignId: campaign.id, metric: 'cost_per_acquired_or_reactivated_card_usd', value: newCards === 0 ? null : cashback / newCards, provenance: provenance(inputs, 'estimated'), methodNote: 'Campaign-linked cashback cost divided by accounts acquired or reactivated in the window.', computedAt: inputs.computedAt }),
    result({ campaignId: campaign.id, metric: 'unstake_within_30d_share', value: persistence.unstakeShare, provenance: provenance(inputs, 'estimated'), methodNote: 'Share of accounts staking or depositing in the 14-day run-up that withdrew or unstaked within 30 days after the campaign.', computedAt: inputs.computedAt }),
  ];
  for (const point of persistence.campaign) {
    rows.push(result({ campaignId: campaign.id, metric: `persistence_week_${point.week}`, value: point.retainedShare, provenance: provenance(inputs, 'estimated'), methodNote: point.observable ? `Share of campaign-acquired or reactivated accounts with a settlement in the seven-day window beginning at week ${point.week}.` : `Not yet observable: the dataset does not cover the full week-${point.week} measurement window.`, computedAt: inputs.computedAt }));
  }
  const finalEventPoint = token.points.at(-1);
  rows.push(result({ campaignId: campaign.id, metric: 'token_cumulative_abnormal_return', value: finalEventPoint?.cumulativeAbnormalReturn ?? null, ciLow: finalEventPoint?.ciLow ?? null, ciHigh: finalEventPoint?.ciHigh ?? null, provenance: provenance(inputs, 'estimated'), methodNote: token.reason ?? `ETHFI log return minus alpha and beta times BTC return. Beta ${numeric(token.beta)} estimated from days -90 to -15; cumulative event window is -7 to +7.`, computedAt: inputs.computedAt }));
  return rows;
}

export function estimateAllCampaigns(inputs: EstimatorInputs, registry: readonly Campaign[]): CampaignResult[] {
  return registry.flatMap((campaign) => estimateCampaign(inputs, campaign));
}

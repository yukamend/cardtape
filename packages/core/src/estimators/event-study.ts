import type { Campaign, MarketPrice } from '../types';
import { mean } from './statistics';

const DAY_MS = 86_400_000;

export interface EventStudyPoint {
  relativeDay: number;
  ethfiReturn: number;
  benchmarkReturn: number;
  abnormalReturn: number;
  cumulativeAbnormalReturn: number;
  ciLow: number;
  ciHigh: number;
}

export interface TokenEventStudy {
  campaignId: string;
  estimable: boolean;
  reason: string | null;
  alpha: number | null;
  beta: number | null;
  residualStdDev: number | null;
  points: readonly EventStudyPoint[];
}

function dailyReturns(prices: readonly MarketPrice[], symbol: 'ETHFI' | 'BTC'): Map<string, number> {
  const series = prices.filter((price) => price.symbol === symbol).sort((a, b) => a.observedAt.getTime() - b.observedAt.getTime());
  const returns = new Map<string, number>();
  for (let index = 1; index < series.length; index += 1) {
    const current = series[index];
    const previous = series[index - 1];
    if (!current || !previous) continue;
    returns.set(current.observedAt.toISOString().slice(0, 10), Math.log(Number(current.priceUsd) / Number(previous.priceUsd)));
  }
  return returns;
}

export function estimateTokenEventStudy(prices: readonly MarketPrice[], campaign: Campaign): TokenEventStudy {
  if (!campaign.announcedAt) return { campaignId: campaign.id, estimable: false, reason: 'Campaign has no recorded announcement timestamp.', alpha: null, beta: null, residualStdDev: null, points: [] };
  const ethfi = dailyReturns(prices, 'ETHFI');
  const benchmark = dailyReturns(prices, 'BTC');
  const eventDay = Date.UTC(campaign.announcedAt.getUTCFullYear(), campaign.announcedAt.getUTCMonth(), campaign.announcedAt.getUTCDate());
  const observations: Array<{ x: number; y: number }> = [];
  for (let relativeDay = -90; relativeDay <= -15; relativeDay += 1) {
    const key = new Date(eventDay + relativeDay * DAY_MS).toISOString().slice(0, 10);
    const x = benchmark.get(key);
    const y = ethfi.get(key);
    if (x !== undefined && y !== undefined) observations.push({ x, y });
  }
  if (observations.length < 30) return { campaignId: campaign.id, estimable: false, reason: 'Insufficient pre-event market history to estimate beta.', alpha: null, beta: null, residualStdDev: null, points: [] };
  const xMean = mean(observations.map((observation) => observation.x));
  const yMean = mean(observations.map((observation) => observation.y));
  const covariance = observations.reduce((sum, observation) => sum + (observation.x - xMean) * (observation.y - yMean), 0);
  const variance = observations.reduce((sum, observation) => sum + (observation.x - xMean) ** 2, 0);
  const beta = variance === 0 ? 0 : covariance / variance;
  const alpha = yMean - beta * xMean;
  const residuals = observations.map((observation) => observation.y - (alpha + beta * observation.x));
  const residualStdDev = Math.sqrt(residuals.reduce((sum, value) => sum + value ** 2, 0) / Math.max(1, residuals.length - 2));
  const points: EventStudyPoint[] = [];
  let cumulative = 0;
  let observedDays = 0;
  for (let relativeDay = -7; relativeDay <= 7; relativeDay += 1) {
    const key = new Date(eventDay + relativeDay * DAY_MS).toISOString().slice(0, 10);
    const benchmarkReturn = benchmark.get(key);
    const ethfiReturn = ethfi.get(key);
    if (benchmarkReturn === undefined || ethfiReturn === undefined) continue;
    const abnormalReturn = ethfiReturn - (alpha + beta * benchmarkReturn);
    cumulative += abnormalReturn;
    observedDays += 1;
    const interval = 1.96 * residualStdDev * Math.sqrt(observedDays);
    points.push({ relativeDay, ethfiReturn, benchmarkReturn, abnormalReturn, cumulativeAbnormalReturn: cumulative, ciLow: cumulative - interval, ciHigh: cumulative + interval });
  }
  return { campaignId: campaign.id, estimable: points.length > 0, reason: points.length > 0 ? null : 'No market observations in the event window.', alpha, beta, residualStdDev, points };
}

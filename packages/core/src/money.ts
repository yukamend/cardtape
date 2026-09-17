import type { SettlementCurrency } from './types';

const currencySymbols: Record<SettlementCurrency, string> = { USD: '$', EUR: '€', GBP: '£' };

export function formatMoney(value: string | number, currency: SettlementCurrency = 'USD'): string {
  const numeric = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(numeric)) throw new Error(`Invalid money value: ${String(value)}`);
  const absolute = Math.abs(numeric).toFixed(2);
  const [whole, fractional] = absolute.split('.');
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${numeric < 0 ? '-' : ''}${currencySymbols[currency]}${grouped}.${fractional}`;
}

export function usdToRaw(valueUsd: number, decimals = 6): string {
  if (!Number.isFinite(valueUsd) || valueUsd < 0) throw new Error('USD value must be finite and non-negative');
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 36) throw new Error('Decimals must be an integer between 0 and 36');
  const rendered = valueUsd.toFixed(Math.min(decimals, 12));
  const [whole = '0', fraction = ''] = rendered.split('.');
  const paddedFraction = fraction.padEnd(decimals, '0').slice(0, decimals);
  return (BigInt(whole) * BigInt(10) ** BigInt(decimals) + BigInt(paddedFraction || '0')).toString();
}

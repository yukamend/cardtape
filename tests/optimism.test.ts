import { describe, expect, it } from 'vitest';
import { OptimismSource, OPTIMISM_SOURCE_ID, OPTIMISM_TOKENS } from '../packages/adapters/src/optimism';
import type { RawEvent } from '../packages/core/src/types';

const source = new OptimismSource({ rpcUrl: 'http://127.0.0.1:1', confirmations: 20 });

function raw(eventName: string, args: Record<string, unknown>, token?: { symbol: string; decimals: number }): RawEvent {
  return {
    payload: {
      eventName,
      args,
      transactionHash: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      logIndex: 7,
      blockNumber: 157_000_000,
      blockHash: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      blockTime: new Date('2026-09-17T08:00:00.000Z'),
      finalized: false,
      token,
    },
  };
}

describe('Optimism adapter normalization', () => {
  it('preserves the emitted six-decimal spend value without floating point conversion', () => {
    const [event] = source.normalize(raw('Spend', {
      safe: '0x1111111111111111111111111111111111111111',
      totalUsdAmt: 11_817_922n,
    }));
    expect(event).toMatchObject({
      sourceId: OPTIMISM_SOURCE_ID,
      eventType: 'spend',
      tokenSymbol: 'USD',
      decimals: 6,
      amountRaw: '11817922',
      amountUsd: '11.817922',
      finalized: false,
    });
  });

  it('records only cashback that was actually paid', () => {
    const args = {
      recipient: '0x2222222222222222222222222222222222222222',
      cashbackAmountInToken: 41_503n,
      cashbackInUsd: 41_503n,
      paid: true,
    };
    expect(source.normalize(raw('Cashback', args, { symbol: 'USDC', decimals: 6 }))).toHaveLength(1);
    expect(source.normalize(raw('Cashback', { ...args, paid: false }, { symbol: 'USDC', decimals: 6 }))).toEqual([]);
  });

  it('classifies sETHFI vault movements separately from other Liquid positions', () => {
    const sethfi = source.normalizeTier(raw('LiquidDeposit', {
      safe: '0x3333333333333333333333333333333333333333',
      outputToken: OPTIMISM_TOKENS.sethfi,
      outputAmount: 30_000n * 10n ** 18n,
    }));
    const liquid = source.normalizeTier(raw('LiquidWithdrawal', {
      safe: '0x4444444444444444444444444444444444444444',
      liquidAsset: '0x5555555555555555555555555555555555555555',
      amountToWithdraw: 15_000n * 10n ** 18n,
    }));
    expect(sethfi[0]).toMatchObject({ action: 'stake', asset: 'ETHFI', sourceId: OPTIMISM_SOURCE_ID });
    expect(liquid[0]).toMatchObject({ action: 'withdraw', asset: 'LIQUID', sourceId: OPTIMISM_SOURCE_ID });
  });
});

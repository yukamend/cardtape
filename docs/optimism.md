# OP Mainnet adapter

CARDTAPE indexes ether.fi Cash directly from Optimism Mainnet. The adapter uses the production addresses committed in ether.fi's official [`cash-v3` deployment manifest](https://github.com/etherfi-protocol/cash-v3/blob/master/deployments/mainnet/10/deployments.json).

## Sources

| Fact | Contract | Events |
| --- | --- | --- |
| Card spend | `CashEventEmitter` — `0x380B2e96799405be6e3D965f4044099891881acB` | `Spend` |
| Cashback paid | same emitter | `Cashback` where `paid = true`; `PendingCashbackCleared` |
| sETHFI position movement | `EtherFiLiquidModuleWithReferrer` — `0xA051246A613E3216DD90402453D3B8aD63E71Cd1` | `LiquidDeposit`, `LiquidWithdrawal` where the liquid asset is sETHFI |
| Other Liquid position movement | `EtherFiLiquidModule` and the referrer module | `LiquidDeposit`, `LiquidWithdrawal` |
| New distributor payouts | `CashbackDistributor` — `0x38F2fBb259F042DE3A601E0f7135f768DE08F5A2` | `CashbackAwarded` |

The addresses and ABI fragments are versioned in `packages/adapters/src/optimism.ts`. Token metadata is read from the token contract when it is not one of the known production assets.

## Normalization

- `Spend.totalUsdAmt` is the contract's six-decimal payment-USD value. It is stored without a JavaScript number conversion as `token_symbol = USD`, `decimals = 6`, and the exact integer `amount_raw`.
- A `Cashback` row is created only when its indexed `paid` flag is true. Deferred cashback becomes a row only when `PendingCashbackCleared` appears.
- Cashback preserves the actual payout token and raw token amount. Its emitted six-decimal USD value is stored separately in `amount_usd`.
- `CashbackAwarded` preserves the token amount but leaves `amount_usd = NULL`; the event has no USD value and CARDTAPE does not invent one.
- sETHFI Liquid deposits/withdrawals become ETHFI stake/unstake tier facts. Other supported vaults become Liquid deposit/withdraw tier facts. These are position movements, not a claim that a membership tier changed.
- Every OP row has `provenance = measured`. Merchant, MCC, country, approval, and authorization data remain unavailable.

## Cursor and reorg contract

The adapter cursor stores the last fully scanned block number and hash in `ingest_cursor`. Spend rows, tier rows, and the cursor commit in one PostgreSQL transaction. On restart the worker compares the stored hash with the canonical OP block:

1. If it matches, scanning resumes at the next block.
2. If it differs, the worker rewinds 64 blocks by default, deletes this adapter's facts above the rewind point, and re-ingests them.
3. Rows land immediately with `finalized = false` and are promoted after 20 confirmations.
4. Primary keys remain `(chain_id, tx_hash, log_index)`, so replaying an unchanged window inserts zero rows.

Tier facts carry `source_id` as well as spend facts. This keeps a reorg cleanup scoped to the OP adapter and prevents synthetic or future adapters from being touched.

## Local operation

The public OP endpoint is the zero-configuration default. Set `OPTIMISM_RPC_URL` in `.env` to use another endpoint.

```bash
npm run indexer:once
npm run indexer
```

The one-shot command scans 25 recent blocks on first use. The long-running worker catches up without sleeping, then polls every two seconds. To verify idempotency against the last scanned window:

```bash
npm run indexer:once -- --replay-blocks 25
```

The replay mode deliberately skips finalization updates, so a successful gate reports zero inserted and zero finalized rows.

Configuration knobs are documented in `.env.example`: confirmation depth, block batch size, initial lookback, poll interval, reorg depth, and an optional explicit start block.

## Scope boundary

The adapter establishes measured settlement, cashback, and qualifying-position facts. It does not assign cashback to a campaign when the on-chain event contains no campaign identifier. The iPhone campaign payout is scheduled for November 1, 2026; until that event exists and its public payout rule can be reconciled, CARDTAPE must not present a fabricated measured campaign cost.

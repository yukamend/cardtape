# Tier reconstruction

CARDTAPE reconstructs consumer membership as half-open `tier_period` intervals. It does not infer an assigned tier from token quantities.

## Authoritative inputs

- `EtherFiSafeFactory` `0xF4e147Db314947fC1275a8CbB6Cde48c510cd8CF` emits `BeaconProxyDeployed`. A newly deployed Safe starts in the contract's default `Pepe` enum value, mapped to the public Core tier.
- `CashEventEmitter` `0x380B2e96799405be6e3D965f4044099891881acB` emits `SafeTiersSet(address[] safes, uint8[] tiers)`.
- `CashModule` `0x7Ca0b75E67E33c0014325B739A8d019C4FE445F0` exposes `getSafeTier(address)` for the reconciliation gate.

The official contract enum is ordered `Pepe`, `Wojak`, `Chad`, `Whale`, `Business`. The official cashback configuration assigns those entries 2%, 3%, 3%, 4%, and 2%, respectively, which maps the four consumer levels to Core, Luxe, Pinnacle, and VIP. Business is retained during reconciliation but is intentionally excluded from consumer `tier_period` rows.

The public membership documentation confirms the consumer level names and benefits but does not publish population counts by level. Consequently there is no external tier-count figure to compare. The stronger available check is exact on-chain reconciliation at one finalized block: the number of reconstructed accounts must equal factory deployments, and each account's reconstructed tier must equal `CashModule.getSafeTier`.

Sources:

- Official contracts: https://github.com/etherfi-protocol/cash-v3
- Official membership levels: https://help.ether.fi/en/articles/776152-membership-level-benefits

## Command and invariants

```bash
npm run tiers:reconstruct
```

The command:

1. finds the deployment block for the Safe factory and event emitter;
2. scans only through the configured finalized head, with bounded and adaptively split log ranges;
3. resolves block timestamps and sorts changes by block, log, and array position;
4. rebuilds the source's intervals in one PostgreSQL transaction;
5. stores the finalized cursor; and
6. fails if either reconciliation check differs.

The emitted tier does not reveal whether points, sETHFI, Liquid assets, payment, or an invitation caused the assignment. `qualified_by` therefore remains `unknown` for measured periods. Stake and Liquid events remain separate measured facts and are not promoted into a tier claim.

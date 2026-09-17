# CARDTAPE working agreement

## Product constraints

1. On-chain card data is settlement data, not authorization data. Never imply merchant, MCC, country, decline, approval-rate, or FX-spread visibility.
2. Campaign attribution is inference. Render the campaign signature caveat verbatim and keep control-group limitations visible.
3. Every metric requires provenance: `measured`, `inferred`, `estimated`, or `demo`. Synthetic facts are always `demo`.

## Data invariants

- `spend_event` and `tier_event` are append-only and idempotent on `(chain_id, tx_hash, log_index)`.
- `amount_raw` is `numeric(78,0)` in Postgres and a decimal string in TypeScript. Never convert uint256 values through JavaScript `number`.
- `tier_period` is an interval table. Starts are inclusive, ends are exclusive, and periods for an account may not overlap.
- `token_symbol`, `amount_raw`, and `settlement_ccy` are stored truth. `amount_usd` is derived, nullable, and never silently zero.
- Cursor updates and fact inserts belong in one transaction.
- Campaign registry changes are reviewed source changes, not runtime edits.

## Commands

- `npm run db:local:start` — start isolated local Postgres on port 54329.
- `npm run db:migrate` — apply versioned migrations.
- `npm run seed` — generate and idempotently load the 18-month fixture.
- `npm run seed:dry` — generate without a database.
- `npm run estimate` — recompute every campaign result from immutable database facts.
- `npm run typecheck` — strict TypeScript check.
- `npm test` — unit tests; includes Postgres integration when `DATABASE_URL` is set.
- `npm run build` — production web build.

Do not add live adapters, extra programs, accounts, alerts, or unrelated surfaces before the estimator layer and its synthetic gates remain green.

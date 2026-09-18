# CARDTAPE

CARDTAPE is a crypto-card campaign effectiveness terminal. The current local implementation covers one program, ether.fi Cash, with a versioned campaign registry, append-only settlement facts, retrospective tier intervals, deterministic synthetic history, database-enforced provenance, verified campaign estimators, a live OP Mainnet adapter, and a local Postgres-to-WebSocket settlement tape.

All generated fixture rows carry `provenance = 'demo'`. They are test data, not claims about live card activity.

## Local setup

Requirements: Node.js 22+, npm, and PostgreSQL 16+. The repository includes a local Postgres lifecycle script and uses port `54329` so it does not collide with a default installation.

```bash
cp .env.example .env
npm install
npm run db:local:start
npm run db:migrate
npm run seed
npm run tiers:reconstruct
npm run estimate
npm run tape
```

In a second terminal, start the OP Mainnet indexer:

```bash
npm run indexer
```

In a third terminal:

```bash
npm run dev
```

Open `http://localhost:3000`. New OP facts normally reach the browser within one 2-second poll. Use `npm run indexer:once` for one bounded 25-block import. `npm run tape:dev` remains available as an explicit synthetic replay; it does not create fact rows. Stop the database with `npm run db:local:stop`.

`npm run tiers:reconstruct` scans finalized Safe deployments and tier assignments, rebuilds measured `tier_period` intervals atomically, and fails if the reconstructed current state differs from the Cash contract. The live `/tiers` endpoint then serves current population, 30-day net flow, and a 12-week interval history to the terminal.

## Verification

```bash
npm run typecheck
npm test
npm run tape:stress
npm run build
```

With local Postgres running, `npm test` also executes the database integration test. Running `npm run seed` repeatedly is safe: immutable facts use conflict-free primary keys and the row counts do not change.

## Data layout

- `packages/core` — domain types, campaign registry, tier ladder, interval rules, estimators, tape classification, and frame buffer.
- `packages/db` — Drizzle schema, migrations, database client, idempotent write paths, and tape snapshot queries.
- `packages/adapters` — deterministic 18-month synthetic source plus the measured OP Mainnet adapter.
- `apps/indexer` — migration, seed, estimator, indexer, and WebSocket broadcaster entry points.
- `tests` — deterministic generation, idempotency, tier intervals, money, registry, estimators, tape backpressure, and Postgres integration checks.

## Non-negotiable invariants

- Settlement data is not authorization data. Merchant, MCC, country, declines, approval rate, and FX spread are unavailable.
- Campaign attribution is inference and must remain labelled.
- Every published metric has provenance and a method note.
- `amount_raw` is a decimal string backed by `numeric(78,0)`; it never passes through a JavaScript number.
- Spend and tier facts are idempotent on `(chain_id, tx_hash, log_index)`.
- Tier membership is an interval, not a mutable current-state field. PostgreSQL rejects overlaps.
- Settlement currency remains a first-class dimension; derived USD may be `NULL` and is never replaced with zero.

## Estimator gate

The synthetic source injects known campaign effects. CI verifies that:

- the difference-in-differences interval contains the injected iPhone campaign volume;
- a campaign-free placebo interval contains zero;
- the incentivized ticket-size signature is detected;
- persistence and post-window unstake cohorts are observable; and
- the token event study estimates beta outside the event window.

Estimator definitions and assumptions are recorded in `docs/estimators.md`.

## Tape gate

New adapter facts commit their ingest cursor and rows in one transaction, then publish only newly inserted rows through Postgres `NOTIFY`. One local WebSocket process fans those payloads out to browsers. The client owns a 500-row ring buffer, ingests while visually paused, and coalesces at most 50 DOM inserts per animation frame. CI injects 500 events and verifies all 500 reach the rendered ring with no duplicates or dropped payloads. With the tape server running, `npm run tape:stress` also pushes 500 unique notifications through the real Postgres and WebSocket path without inserting facts.

Campaign-window shading and signature marks are derived from the versioned registry plus the account tier at event time. They are never merchant labels. The full contract is recorded in `docs/tape.md`.

## OP Mainnet gate

The adapter reads the official ether.fi Cash emitter and Liquid module deployments, keeps its cursor in Postgres, verifies the cursor block hash on restart, rewinds a bounded range on reorg, and promotes rows after 20 confirmations. Replaying a block window inserts zero rows. Contract addresses, event normalization, and operational commands are recorded in `docs/optimism.md`.

Synthetic history remains labelled `demo`; OP rows are individually labelled `measured`. Campaign attribution remains inference and is not manufactured from settlement logs that do not expose merchant identity.

## Tier reconstruction gate

The tier job uses the official Safe factory's `BeaconProxyDeployed` event for the initial Core interval and the official Cash emitter's `SafeTiersSet` event for later transitions. It keeps Business accounts outside the four consumer membership tiers and records the qualification route as unknown because that cause is not emitted. A successful run proves both that every factory deployment is represented and that every reconstructed current tier matches `CashModule.getSafeTier` at the same finalized block. Details are in `docs/tiers.md`.

The Methodology view renders campaign signature and method notes directly from `packages/core/src/campaigns.ts`. Screenshot mode (`S` or `[S]`) uses the browser print path and burns the capture time and current URL into the exported readout.

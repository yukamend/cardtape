# CARDTAPE

CARDTAPE is a crypto-card campaign effectiveness terminal. The current local implementation covers one program, ether.fi Cash, with a versioned campaign registry, append-only settlement facts, retrospective tier intervals, deterministic synthetic history, database-enforced provenance, verified campaign estimators, and a local Postgres-to-WebSocket settlement tape.

All generated fixture rows carry `provenance = 'demo'`. They are test data, not claims about live card activity.

## Local setup

Requirements: Node.js 22+, npm, and PostgreSQL 16+. The repository includes a local Postgres lifecycle script and uses port `54329` so it does not collide with a default installation.

```bash
cp .env.example .env
npm install
npm run db:local:start
npm run db:migrate
npm run seed
npm run estimate
npm run tape:dev
```

In a second terminal:

```bash
npm run dev
```

Open `http://localhost:3000`. `tape:dev` replays already-seeded synthetic campaign-window rows through Postgres `NOTIFY`; it does not create new fact rows. Use `npm run tape` to wait only for newly ingested events. Stop the database with `npm run db:local:stop`.

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
- `packages/adapters` — deterministic 18-month synthetic source with known campaign effects.
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

## Deliberately deferred

The OP Mainnet adapter and real chain data belong to Phase 4. The current site remains explicit demo data until those live inputs are independently verified.

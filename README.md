# CARDTAPE

CARDTAPE is a crypto-card campaign effectiveness terminal. The current local foundation covers one program, ether.fi Cash, with a versioned campaign registry, append-only settlement facts, retrospective tier intervals, deterministic synthetic history, and database-enforced provenance.

All generated fixture rows carry `provenance = 'demo'`. They are test data, not claims about live card activity.

## Local setup

Requirements: Node.js 22+, npm, and PostgreSQL 16+. The repository includes a local Postgres lifecycle script and uses port `54329` so it does not collide with a default installation.

```bash
cp .env.example .env
npm install
npm run db:local:start
npm run db:migrate
npm run seed
npm run dev
```

Open `http://localhost:3000`. Stop the database with `npm run db:local:stop`.

## Verification

```bash
npm run typecheck
npm test
npm run build
```

With local Postgres running, `npm test` also executes the database integration test. Running `npm run seed` repeatedly is safe: immutable facts use conflict-free primary keys and the row counts do not change.

## Data layout

- `packages/core` — domain types, hand-curated campaign registry, tier ladder, money and interval rules.
- `packages/db` — Drizzle schema, migrations, database client, and idempotent write paths.
- `packages/adapters` — deterministic 18-month synthetic source with known campaign effects.
- `apps/indexer` — migration, seed, and indexer entry points.
- `tests` — deterministic generation, idempotency, tier intervals, money, registry, migration, and Postgres integration checks.

## Non-negotiable invariants

- Settlement data is not authorization data. Merchant, MCC, country, declines, approval rate, and FX spread are unavailable.
- Campaign attribution is inference and must remain labelled.
- Every published metric has provenance and a method note.
- `amount_raw` is a decimal string backed by `numeric(78,0)`; it never passes through a JavaScript number.
- Spend and tier facts are idempotent on `(chain_id, tx_hash, log_index)`.
- Tier membership is an interval, not a mutable current-state field. PostgreSQL rejects overlaps.
- Settlement currency remains a first-class dimension; derived USD may be `NULL` and is never replaced with zero.

## Deliberately deferred

The OP Mainnet adapter, live WebSocket fan-out, and causal estimators belong to later phases. The current work establishes and verifies the storage and synthetic-ground-truth layer they depend on.

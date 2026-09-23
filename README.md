# CARDTAPE

CARDTAPE is a crypto-card campaign effectiveness terminal. Its published readouts are snapshots of onchain evidence from ether.fi Cash on Optimism and Plasma One's XPL lock vault on Plasma. The synthetic dataset remains available for tests and explicit demo replay, but is excluded from published snapshots.

All generated fixture rows carry `provenance = 'demo'`. They are test data, not claims about live card activity.

## Optional local PostgreSQL archive

The published site and regular snapshot updates need Node.js 22+ and npm, but no database. PostgreSQL 16+ is only needed to recreate the original historical archive, run database integration tests, or perform the one-time checkpoint conversion. The optional local Postgres script uses port `54329`.

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

`npm run audit:optimism -- --blocks 1000` performs a read-only, field-for-field comparison between a finalized raw Optimism window and the persisted spend, cashback, and tier-position facts. Pass `--through-block N` to reproduce a previously published audit range exactly.

`npm run backfill:optimism -- --from-block N --through-block N` idempotently loads a finalized historical range without moving the continuous indexer's cursor. Use it to load campaign windows before recomputing measured results. The new rolling ether.fi Cash monitor compares the latest 24 hours with the preceding 24 hours and updates from finalized measured events. Historical campaign KPIs remain blank until both windows are fully covered. The 2025 Membership Rewards and early-2026 Lunar New Year campaigns predate the current Cash v3 emitter; those require a separate, verified legacy onchain adapter, not the existing backfill command.

The Plasma One snapshot queries `Locked` events from `0xe035a6a5aba726bd162e273a22ff85ae5f6e04c3` through `PLASMA_RPC_URL`. A lock of at least 100,000 WXPL is shown as a Platinum-sized lock proxy. Smaller top-ups can also qualify, and the vault does not prove signup, card activation, purchases, or FX fees. The displayed comparison is descriptive, not proof that the Platinum fee change caused lock activity.

## Publish a snapshot without PostgreSQL

The published website reads `public/snapshots/current.json`. Future updates use Optimism and Plasma RPC plus a compressed local checkpoint in `.cardtape/snapshot-state.json.gz`; PostgreSQL and the continuous indexer are not needed. On the existing laptop, the initial snapshot and checkpoint were converted once from the completed local backfill. For another checkout with the published snapshot but no checkpoint, initialize from Optimism RPC with `npm run snapshot:init:rpc` (the first scan covers about 50 hours).

To update and publish:

```bash
npm run snapshot:generate
git add public/snapshots/current.json
git commit -m "Publish onchain snapshot"
git push
```

`snapshot:generate` catches up from the saved finalized Optimism block, retains only about 50 hours of detailed spend records in the local compressed checkpoint, computes the rolling Cash readout, and scans Plasma for the 7, 14, and 30-day comparisons. The published JSON includes 500 recent finalized measured tape events and the fixed historical iPhone readout from the original verified backfill. The checkpoint is roughly 8 MB and is ignored by Git; only the small public JSON is committed. If generation fails, the previous published snapshot stays in place. The command saves progress while scanning, so a later run can resume.

Tier classifications retain the timestamp of the earlier onchain reconstruction; newer tape events have an unknown tier rather than an unverified label. The website continues showing the last published snapshot when the laptop is off. Publishing a newer one requires a Git push and Vercel deployment. No hosted database, local database service, tunnel, or GitHub database secret is needed. Never commit `.env`, `.cardtape`, or raw PostgreSQL dumps.

The one-time conversion commands for an existing PostgreSQL backfill are `npm run snapshot:generate:from-db` followed by `npm run snapshot:bootstrap`. They are not part of regular publishing.

## GitHub + Vercel deployment

The web app is built for Vercel with `npm run build:vercel`; the Nitro build emits Vercel Build Output API artifacts. The Vercel project should use the `Other` framework preset, keep the repository root as the project root, and use the committed `vercel.json` build command. It serves the UI and the checked-in snapshot without a database connection.

1. Create a public GitHub repository, push the application and an initial snapshot, and connect the repository to Vercel.
2. Leave `DATABASE_URL`, `NEXT_PUBLIC_TAPE_API_URL`, and `NEXT_PUBLIC_TAPE_WS_URL` unset in Vercel. `DATABASE_URL` is only needed for the one-time conversion or optional local database workflows.
3. Add `cardtape.bimlabs.xyz` as the Vercel production domain. At the DNS provider, create the CNAME Vercel shows for that project, then wait for domain verification and certificate issuance.

The public GitHub repository is `yukamend/cardtape`. The snapshot generator runs locally and publishes through a normal Git push; no hosted database is required.

## Verification

```bash
npm run typecheck
npm test
npm run tape:stress
npm run build:vercel
```

With local Postgres running, `npm test` also executes the database integration test. Running `npm run seed` repeatedly is safe: immutable facts use conflict-free primary keys and the row counts do not change.

## Data layout

- `packages/core` — domain types, campaign registry, tier ladder, interval rules, estimators, tape classification, and frame buffer.
- `packages/db` — Drizzle schema, migrations, database client, idempotent write paths, and tape snapshot queries.
- `packages/adapters` — measured Optimism and Plasma adapters, plus a synthetic source used only for tests and explicit demo replay.
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

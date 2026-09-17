# Settlement tape contract

## Data path

1. An adapter batch and its cursor commit in one Postgres transaction.
2. Only rows actually inserted by that transaction are published on `cardtape_spend_event`.
3. The tape server keeps one Postgres `LISTEN` connection and fans each compact event payload out over `/tape`.
4. A connecting browser receives the latest 500 rows as a snapshot, followed by individual event messages.
5. The browser ingests every message into a 500-row newest-first ring and flushes at most 50 inserts per animation frame.

Visual pause stops React updates, not WebSocket ingestion. Resume immediately renders the current ring.

## Classification

Campaign windows use inclusive starts and exclusive ends from the versioned registry. A signature mark requires:

- a spend event inside that campaign window;
- the account's interval-derived tier to be eligible;
- a non-null USD amount satisfying at least one configured ticket bound.

Window shading says only that the settlement occurred during a registered campaign. A signature mark is an inferred candidate, never a merchant identification. Unpriced rows can appear on the tape but cannot match a USD ticket signature.

## Local modes

- `npm run tape` listens for new adapter facts.
- `npm run tape:dev` starts from the pre-campaign snapshot and replays already-seeded campaign-window facts through Postgres `NOTIFY` at eight events per second. Replay is transport demonstration only: it does not insert or mutate fact rows.

The local endpoints are `ws://localhost:8788/tape` and `http://localhost:8788/health`.

## Performance gate

The test suite injects 500 unique events into the frame buffer at once, drains them in ten 50-row frames, and asserts that the final ring contains all 500 unique identities with no duplicates or evictions. `npm run tape:stress` separately sends 500 unique, ephemeral Postgres notifications through the running WebSocket server and verifies that a real client receives every identity. Stress payloads are never inserted into `spend_event`.

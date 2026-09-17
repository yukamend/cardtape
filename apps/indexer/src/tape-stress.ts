import 'dotenv/config';
import WebSocket, { type RawData } from 'ws';
import { createDatabase, requireDatabaseUrl } from '../../../packages/db/src/client';
import { SPEND_EVENT_CHANNEL, spendEventNotification } from '../../../packages/db/src/tape';
import type { SpendEvent } from '../../../packages/core/src/types';

const EVENT_COUNT = 500;
const TIMEOUT_MS = 10_000;

function messageText(data: RawData): string {
  if (Array.isArray(data)) return Buffer.concat(data).toString('utf8');
  if (data instanceof ArrayBuffer) return Buffer.from(data).toString('utf8');
  return data.toString('utf8');
}

function stressEvent(index: number): SpendEvent {
  return {
    chainId: 10,
    txHash: `0x${index.toString(16).padStart(64, '0')}`,
    logIndex: 99,
    blockNumber: 999_000_000 + index,
    blockTime: new Date('2026-09-17T12:00:00.000Z'),
    eventType: 'spend',
    programId: 'etherfi-cash',
    cardAccount: `0x${'f'.repeat(40)}`,
    tokenSymbol: 'USDC',
    decimals: 6,
    amountRaw: String((index + 1) * 1_000_000),
    settlementCcy: 'USD',
    amountUsd: `${index + 1}.0000`,
    priceSource: 'synthetic:stress',
    pricedAt: new Date('2026-09-17T12:00:00.000Z'),
    sourceId: 'synthetic:stress',
    provenance: 'demo',
    finalized: true,
  };
}

async function main(): Promise<void> {
  const { pool } = createDatabase(requireDatabaseUrl());
  const socket = new WebSocket(process.env.TAPE_WS_URL ?? 'ws://localhost:8788/tape');
  const expectedIds = new Set(Array.from({ length: EVENT_COUNT }, (_, index) => `10:0x${(index + 1).toString(16).padStart(64, '0')}:99`));
  const received = new Set<string>();
  let startedAt = 0;

  try {
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error(`Timed out after receiving ${received.size}/${EVENT_COUNT} stress events.`)), TIMEOUT_MS);
      socket.on('error', reject);
      socket.on('message', async (data) => {
        const message = JSON.parse(messageText(data)) as { type: string; event?: { id: string } };
        if (message.type === 'snapshot' && startedAt === 0) {
          startedAt = performance.now();
          const payloads = Array.from({ length: EVENT_COUNT }, (_, index) => JSON.stringify(spendEventNotification(stressEvent(index + 1))));
          await pool.query(
            'SELECT pg_notify($1, payload) FROM unnest($2::text[]) AS payload',
            [SPEND_EVENT_CHANNEL, payloads],
          );
          return;
        }
        const id = message.event?.id;
        if (id && expectedIds.has(id)) received.add(id);
        if (received.size === EVENT_COUNT) {
          clearTimeout(timeout);
          const elapsed = performance.now() - startedAt;
          process.stdout.write(`Received ${EVENT_COUNT}/${EVENT_COUNT} unique tape events in ${elapsed.toFixed(1)}ms with zero transport loss.\n`);
          resolve();
        }
      });
    });
  } finally {
    socket.close();
    await pool.end();
  }
}

await main();

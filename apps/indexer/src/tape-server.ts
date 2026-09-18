import 'dotenv/config';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { WebSocket, WebSocketServer } from 'ws';
import { campaigns, PROGRAM_ID } from '../../../packages/core/src/campaigns';
import {
  classifyTapeEvent,
  TapeFrameBuffer,
  TAPE_RING_CAPACITY,
  type TapeMessage,
} from '../../../packages/core/src/tape';
import { tierAt } from '../../../packages/core/src/tier-periods';
import { createDatabase, requireDatabaseUrl } from '../../../packages/db/src/client';
import {
  loadTapeRange,
  loadTapeSnapshot,
  loadTierSummary,
  loadTierPeriods,
  parseSpendEventNotification,
  SPEND_EVENT_CHANNEL,
  spendEventNotification,
} from '../../../packages/db/src/tape';

export interface TapeServerOptions {
  host?: string;
  port?: number;
  asOf?: Date;
  replayRate?: number;
  databaseUrl?: string;
}

export interface RunningTapeServer {
  host: string;
  port: number;
  mode: 'live' | 'demo-replay';
  close(): Promise<void>;
}

function send(socket: WebSocket, message: TapeMessage): void {
  if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
}

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function parseReplayRate(arguments_: readonly string[]): number {
  const position = arguments_.indexOf('--replay');
  if (position === -1) return 0;
  const rate = Number(arguments_[position + 1] ?? '8');
  if (!Number.isFinite(rate) || rate <= 0) throw new Error('--replay requires a positive events-per-second value.');
  return rate;
}

export async function startTapeServer(options: TapeServerOptions = {}): Promise<RunningTapeServer> {
  const host = options.host ?? '::1';
  const requestedPort = options.port ?? 8788;
  const asOf = options.asOf ?? new Date();
  const replayRate = options.replayRate ?? 0;
  const mode = replayRate > 0 ? 'demo-replay' : 'live';
  const { pool } = createDatabase(options.databaseUrl ?? requireDatabaseUrl());
  const listener = await pool.connect();
  const publisher = replayRate > 0 ? await pool.connect() : null;
  const tierPeriods = await loadTierPeriods(pool, PROGRAM_ID);
  const replayCampaign = replayRate > 0
    ? campaigns.find((campaign) => campaign.startsAt <= asOf && campaign.endsAt > asOf)
    : undefined;
  const snapshotAsOf = replayCampaign?.startsAt ?? asOf;
  const snapshotRecords = await loadTapeSnapshot(pool, PROGRAM_ID, snapshotAsOf, TAPE_RING_CAPACITY);
  const buffer = new TapeFrameBuffer(TAPE_RING_CAPACITY);
  buffer.replace(snapshotRecords.map((record) => classifyTapeEvent(record.event, record.tier, campaigns)));

  const server = createServer((request, response) => {
    if (request.url === '/health') {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ ok: true, source: 'postgres', mode, clients: sockets.size }));
      return;
    }
    if (request.url === '/tiers') {
      void loadTierSummary(pool, PROGRAM_ID).then((summary) => {
        response.writeHead(summary ? 200 : 404, {
          'access-control-allow-origin': '*',
          'cache-control': 'no-store',
          'content-type': 'application/json',
        });
        response.end(JSON.stringify(summary ?? { error: 'No tier periods loaded' }));
      }).catch((error) => {
        response.writeHead(500, { 'access-control-allow-origin': '*', 'content-type': 'application/json' });
        response.end(JSON.stringify({ error: String(error) }));
      });
      return;
    }
    response.writeHead(404).end();
  });
  const webSockets = new WebSocketServer({ noServer: true });
  const sockets = new Set<WebSocket>();
  let stopped = false;

  const broadcast = (message: TapeMessage): void => {
    for (const socket of sockets) send(socket, message);
  };

  webSockets.on('connection', (socket) => {
    sockets.add(socket);
    send(socket, { type: 'snapshot', events: buffer.snapshot(), asOf: snapshotAsOf.toISOString() });
    broadcast({ type: 'status', source: 'postgres', mode, clients: sockets.size });
    socket.on('close', () => {
      sockets.delete(socket);
      broadcast({ type: 'status', source: 'postgres', mode, clients: sockets.size });
    });
  });

  server.on('upgrade', (request, socket, head) => {
    if (request.url !== '/tape') {
      socket.destroy();
      return;
    }
    webSockets.handleUpgrade(request, socket, head, (webSocket) => webSockets.emit('connection', webSocket, request));
  });

  listener.on('notification', (notification) => {
    if (notification.channel !== SPEND_EVENT_CHANNEL || !notification.payload) return;
    try {
      const event = parseSpendEventNotification(notification.payload);
      const resolvedTier = tierAt(tierPeriods, event.cardAccount, event.blockTime, event.provenance);
      const tapeEvent = classifyTapeEvent(event, resolvedTier, campaigns);
      buffer.enqueue(tapeEvent);
      buffer.flush(TAPE_RING_CAPACITY);
      broadcast({ type: 'event', event: tapeEvent });
    } catch (error) {
      process.stderr.write(`Ignored invalid ${SPEND_EVENT_CHANNEL} payload: ${String(error)}\n`);
    }
  });
  await listener.query(`LISTEN ${SPEND_EVENT_CHANNEL}`);

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(requestedPort, host, resolve);
  });
  const address = server.address() as AddressInfo;

  if (publisher && replayCampaign) {
    const replayRecords = await loadTapeRange(pool, PROGRAM_ID, replayCampaign.startsAt, asOf);
    void (async () => {
      const batchSize = Math.max(1, Math.ceil(replayRate / 20));
      const interval = Math.max(10, Math.round((batchSize / replayRate) * 1_000));
      for (let index = 0; index < replayRecords.length && !stopped; index += batchSize) {
        const batch = replayRecords.slice(index, index + batchSize);
        const payloads = batch.map((record) => JSON.stringify(spendEventNotification(record.event)));
        await publisher.query(
          'SELECT pg_notify($1, payload) FROM unnest($2::text[]) AS payload',
          [SPEND_EVENT_CHANNEL, payloads],
        );
        await wait(interval);
      }
    })().catch((error) => process.stderr.write(`Tape demo replay stopped: ${String(error)}\n`));
  }

  return {
    host,
    port: address.port,
    mode,
    async close() {
      stopped = true;
      for (const socket of sockets) socket.close(1001, 'Server stopping');
      await listener.query(`UNLISTEN ${SPEND_EVENT_CHANNEL}`);
      listener.release();
      publisher?.release();
      await new Promise<void>((resolve) => webSockets.close(() => resolve()));
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
      await pool.end();
    },
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const replayRate = parseReplayRate(process.argv.slice(2));
  const running = await startTapeServer({ replayRate });
  process.stdout.write(`CARDTAPE tape server ready at ws://localhost:${running.port}/tape (${running.mode}).\n`);
  const shutdown = async () => {
    await running.close();
    process.exit(0);
  };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
}

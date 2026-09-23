import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { promisify } from 'node:util';
import { gzip, gunzip } from 'node:zlib';
import type { CampaignImpact } from '../../../packages/core/src/neobanks';
import type { TapeEvent } from '../../../packages/core/src/tape';
import type { PublishedSnapshot } from '../../../packages/core/src/published-snapshot';

const compress = promisify(gzip);
const decompress = promisify(gunzip);

export const SNAPSHOT_STATE_PATH = resolve('.cardtape/snapshot-state.json.gz');
export const PUBLISHED_SNAPSHOT_PATH = resolve('public/snapshots/current.json');

export interface RecentSpend {
  id: string;
  blockNumber: number;
  blockTime: string;
  cardAccount: `0x${string}`;
  amountUsd: string;
}

export interface SnapshotState {
  version: 1;
  cursor: { blockNumber: number; blockHash: `0x${string}`; indexedAt: string };
  tierBlockNumber: number | null;
  tiersIndexedAt: string | null;
  recentSpends: RecentSpend[];
  tape: TapeEvent[];
  fixedCampaigns: Record<string, Record<string, CampaignImpact>>;
}

export async function readSnapshotState(): Promise<SnapshotState> {
  let compressed: Buffer;
  try {
    compressed = await readFile(SNAPSHOT_STATE_PATH);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new Error('No local snapshot checkpoint. Run npm run snapshot:init:rpc first.');
    }
    throw error;
  }
  const value: unknown = JSON.parse((await decompress(compressed)).toString('utf8'));
  if (typeof value !== 'object' || value === null) throw new Error('Snapshot checkpoint is invalid.');
  const state = value as Partial<SnapshotState>;
  if (state.version !== 1 || !state.cursor || !Number.isSafeInteger(state.cursor.blockNumber)
    || !/^0x[0-9a-f]{64}$/i.test(state.cursor.blockHash ?? '')
    || !Array.isArray(state.recentSpends) || !Array.isArray(state.tape)
    || !state.fixedCampaigns || typeof state.fixedCampaigns !== 'object') {
    throw new Error('Snapshot checkpoint is invalid.');
  }
  return state as SnapshotState;
}

export async function writeSnapshotState(state: SnapshotState): Promise<void> {
  const temporary = `${SNAPSHOT_STATE_PATH}.${process.pid}.tmp`;
  await mkdir(dirname(SNAPSHOT_STATE_PATH), { recursive: true });
  await writeFile(temporary, await compress(JSON.stringify(state), { level: 1 }));
  await rename(temporary, SNAPSHOT_STATE_PATH);
}

export async function readPublishedSnapshot(): Promise<PublishedSnapshot> {
  const value = JSON.parse(await readFile(PUBLISHED_SNAPSHOT_PATH, 'utf8')) as PublishedSnapshot;
  if (value.version !== 1 || !value.campaigns) throw new Error('Published snapshot is missing or invalid.');
  return value;
}

export async function writePublishedSnapshot(snapshot: PublishedSnapshot): Promise<void> {
  const temporary = `${PUBLISHED_SNAPSHOT_PATH}.${process.pid}.tmp`;
  await mkdir(dirname(PUBLISHED_SNAPSHOT_PATH), { recursive: true });
  await writeFile(temporary, `${JSON.stringify(snapshot)}\n`);
  await rename(temporary, PUBLISHED_SNAPSHOT_PATH);
}

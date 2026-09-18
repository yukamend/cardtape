import { describe, expect, it } from 'vitest';
import { isTransientRpcError } from '../apps/indexer/src/index';

describe('indexer RPC resilience', () => {
  it('retries provider and transport failures', () => {
    expect(isTransientRpcError(new Error('no backend is currently healthy to serve traffic'))).toBe(true);
    expect(isTransientRpcError(new Error('Your IP has exceeded its requests per second capacity'))).toBe(true);
    expect(isTransientRpcError(new Error('fetch failed: ETIMEDOUT'))).toBe(true);
  });

  it('does not hide deterministic application failures', () => {
    expect(isTransientRpcError(new Error('Invalid event address'))).toBe(false);
    expect(isTransientRpcError(new Error('duplicate key violates unique constraint'))).toBe(false);
  });
});

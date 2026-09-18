'use client';

import { useEffect, useState } from 'react';
import type { Tier } from '../packages/core/src/types';

export interface TierSummary {
  sourceId: string;
  provenance: 'measured' | 'demo';
  asOfBlock: number | null;
  population: Record<Tier, number>;
  flow30d: Record<Tier, number>;
  history: Array<{ at: string; population: Record<Tier, number> }>;
}

function tierUrl(): string {
  if (process.env.NEXT_PUBLIC_TIER_API_URL) return process.env.NEXT_PUBLIC_TIER_API_URL;
  return `${window.location.protocol}//${window.location.hostname}:8788/tiers`;
}

export function useTierSummary(): { data: TierSummary | null; error: boolean } {
  const [data, setData] = useState<TierSummary | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    let stopped = false;
    const load = async () => {
      try {
        const response = await fetch(tierUrl(), { cache: 'no-store' });
        if (!response.ok) throw new Error(`Tier API returned ${response.status}`);
        const next = await response.json() as TierSummary;
        if (!stopped) {
          setData(next);
          setError(false);
        }
      } catch {
        if (!stopped) setError(true);
      }
    };
    void load();
    const timer = window.setInterval(load, 30_000);
    return () => {
      stopped = true;
      window.clearInterval(timer);
    };
  }, []);
  return { data, error };
}

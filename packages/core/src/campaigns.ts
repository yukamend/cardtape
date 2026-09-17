import type { Campaign } from './types';

export const PROGRAM_ID = 'etherfi-cash';

export const campaigns: readonly Campaign[] = [
  {
    id: 'etherfi-membership-rewards-2025',
    programId: PROGRAM_ID,
    name: 'Membership Rewards',
    sourceUrl: 'https://etherfi.gitbook.io/etherfi/events/events/membership-rewards',
    startsAt: new Date('2025-06-01T00:00:00.000Z'),
    endsAt: new Date('2025-09-01T00:00:00.000Z'),
    payoutAt: new Date('2025-09-15T00:00:00.000Z'),
    mechanic: 'cashback_pct',
    eligibleTiers: ['core', 'luxe', 'pinnacle', 'vip'],
    controlTiers: [],
    signature: {
      note: 'The public offer defines a retrospective member cohort, but card merchant data is not visible on-chain. We proxy participation using first-spend timing, points eligibility, and cashback transfers; accounts can satisfy those conditions for unrelated reasons.',
    },
    methodNote: 'This campaign has no clean in-program control tier. Results are descriptive until a defensible matched cohort is defined.',
  },
  {
    id: 'etherfi-lunar-new-year-2026',
    programId: PROGRAM_ID,
    name: 'Lunar New Year 2026',
    sourceUrl: 'https://etherfi.gitbook.io/etherfi/events/events/lunar-new-year-2026',
    announcedAt: new Date('2026-02-03T12:00:00.000Z'),
    startsAt: new Date('2026-02-08T00:00:00.000Z'),
    endsAt: new Date('2026-03-01T00:00:00.000Z'),
    payoutAt: new Date('2026-03-31T00:00:00.000Z'),
    mechanic: 'referral',
    eligibleTiers: ['core', 'luxe', 'pinnacle', 'vip'],
    controlTiers: [],
    region: 'APAC',
    statedBudgetUsd: 20_000,
    signature: {
      minTicketUsd: 88,
      note: 'Region and merchant are not visible on-chain. We proxy qualifying activity as first settlements of $88 or more from newly active accounts during the campaign window, linked by timing to a referring account. This can include non-APAC activity and unrelated purchases.',
    },
    methodNote: 'The referral timing and ticket threshold are observable; APAC eligibility is not. Reported lift is an inference, not merchant- or region-level attribution.',
  },
  {
    id: 'etherfi-iphone18-preorder',
    programId: PROGRAM_ID,
    name: 'iPhone 18 pre-order',
    sourceUrl: 'https://etherfi.gitbook.io/etherfi/events/events/apple-iphone-18-pre-order-promo',
    announcedAt: new Date('2026-09-08T13:00:00.000Z'),
    startsAt: new Date('2026-09-12T13:00:00.000Z'),
    endsAt: new Date('2026-09-19T03:59:00.000Z'),
    payoutAt: new Date('2026-11-01T00:00:00.000Z'),
    mechanic: 'cashback_lottery',
    eligibleTiers: ['luxe', 'pinnacle', 'vip'],
    controlTiers: ['core'],
    statedBudgetUsd: 100_000,
    signature: {
      minTicketUsd: 1_000,
      note: 'Apple is not identifiable on-chain. We proxy qualifying purchases as single settlements of $1,000 or more from eligible-tier accounts within the campaign window. This over-counts unrelated large purchases and under-counts pre-orders split across cards.',
    },
    methodNote: 'Core is the comparison tier, but Core members could qualify by referral. That contamination weakens the difference-in-differences estimate and must remain visible beside it.',
  },
];

export function getCampaign(id: string): Campaign {
  const campaign = campaigns.find((candidate) => candidate.id === id);
  if (!campaign) throw new Error(`Unknown campaign: ${id}`);
  return campaign;
}

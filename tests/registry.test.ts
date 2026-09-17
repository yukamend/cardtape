import { describe, expect, it } from 'vitest';
import { campaigns } from '../packages/core/src/campaigns';

describe('campaign registry', () => {
  it('encodes source URLs, windows, controls, and honest signature notes', () => {
    expect(campaigns.length).toBeGreaterThanOrEqual(3);
    for (const campaign of campaigns) {
      expect(campaign.sourceUrl).toMatch(/^https:\/\//);
      expect(campaign.endsAt.getTime()).toBeGreaterThan(campaign.startsAt.getTime());
      expect(campaign.signature.note.length).toBeGreaterThan(80);
      expect(campaign.methodNote.length).toBeGreaterThan(40);
    }
    const iphone = campaigns.find((campaign) => campaign.id === 'etherfi-iphone18-preorder');
    expect(iphone?.controlTiers).toEqual(['core']);
    expect(iphone?.signature.note).toMatch(/not identifiable on-chain/i);
  });
});

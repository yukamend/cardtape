import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  metadataBase: new URL(process.env.SITE_URL ?? 'https://cardtape-crypto-terminal.chirpy-lime-9333.chatgpt.site'),
  title: 'CARDTAPE — Crypto Card Campaign Terminal',
  description: 'Every crypto card promotion: what it moved, what it cost, and whether it lasted.',
  openGraph: {
    title: 'CARDTAPE — Crypto Card Campaign Terminal',
    description: 'Every promo. What it moved. What it cost.',
    images: [{ url: '/og.png', width: 1200, height: 630, alt: 'CARDTAPE crypto card campaign terminal' }],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'CARDTAPE — Crypto Card Campaign Terminal',
    description: 'Every promo. What it moved. What it cost.',
    images: ['/og.png'],
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}

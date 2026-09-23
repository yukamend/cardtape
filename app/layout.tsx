import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  metadataBase: new URL(process.env.SITE_URL ?? 'https://cardtape.bimlabs.xyz'),
  title: 'CARDTAPE — Neobank Campaign Impact',
  description: 'Compare observable neobank campaign activity against a clear baseline.',
  icons: {
    icon: [{ url: '/favicon.png?v=3', sizes: '256x256', type: 'image/png' }],
  },
  openGraph: {
    title: 'CARDTAPE — Neobank Campaign Impact',
    description: 'Neobank campaigns, measured against a clear baseline.',
    images: [{ url: '/og.png', width: 1200, height: 630, alt: 'CARDTAPE neobank campaign impact dashboard' }],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'CARDTAPE — Neobank Campaign Impact',
    description: 'Neobank campaigns, measured against a clear baseline.',
    images: ['/og.png'],
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}

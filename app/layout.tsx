import './globals.css';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'newsroom — a deck for political streamers',
  description: 'Triage chat-submitted links, get AI summaries and DMCA risk signals, and turn your stream into show notes.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}

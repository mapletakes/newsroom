import './globals.css';
import type { Metadata } from 'next';
import { Toaster } from '@/components/ui/sonner';
import { ThemeProvider } from '@/components/theme-provider';

export const metadata: Metadata = {
  title: 'The Broadside — a deck for political streamers',
  description: 'Triage chat-submitted links, get DMCA risk signals, and turn your stream into show notes.',
};

const THEMES = ['light', 'dark', 'sepia', 'contrast'];

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <link rel="stylesheet" href="https://fonts.googleapis.com/icon?family=Material+Icons&display=swap" />
      </head>
      <body>
        <ThemeProvider attribute="class" defaultTheme="system" enableSystem themes={THEMES}>
          {children}
          <Toaster />
        </ThemeProvider>
      </body>
    </html>
  );
}

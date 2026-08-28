import './globals.css';
import type { Metadata } from 'next';
import { Toaster } from '@/components/ui/sonner';
import { ThemeProvider } from '@/components/theme-provider';
import { QueryProvider } from '@/components/query-provider';
import { TooltipProvider } from '@/components/ui/tooltip';
import { ServiceWorkerRegister } from '@/components/ServiceWorkerRegister';
import { PRESET_NAMES } from '@/lib/theme';

export const metadata: Metadata = {
  title: 'The Broadside — a deck for political streamers',
  description: 'Triage chat-submitted links, get DMCA risk signals, and turn your stream into show notes.',
  // iOS ignores the web manifest for home-screen icons; this covers it.
  // Setting `icons` here replaces (rather than merges with) Next's
  // auto-detected app/icon.svg favicon, so it has to be listed explicitly
  // alongside apple-touch-icon or the browser tab favicon disappears.
  appleWebApp: { title: 'Broadside Mod', statusBarStyle: 'default' },
  icons: { icon: '/icon.svg', apple: '/icons/apple-touch-icon.png' },
};

// Every built-in palette, plus two that aren't palettes at all: 'brand' is the
// stream's own colours and 'mine' the viewer's, both injected as `html.brand` /
// `html.mine` by <StreamTheme /> on the authed pages. All of them have to be
// listed here or next-themes won't put the class on <html>, and the injected
// rules never match. Built from PRESET_NAMES rather than spelled out, so
// adding a palette in lib/theme.ts can't leave this list behind — which would
// fail silently, as a theme that's offered in the menu but never applies.
const THEMES = [...PRESET_NAMES, 'brand', 'mine'];

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>
        <ThemeProvider attribute="class" defaultTheme="system" enableSystem themes={THEMES}>
          <QueryProvider>
            <TooltipProvider delayDuration={200}>
              {children}
              <Toaster />
              <ServiceWorkerRegister />
            </TooltipProvider>
          </QueryProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}

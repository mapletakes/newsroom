import './globals.css';
import type { Metadata } from 'next';
import { Toaster } from '@/components/ui/sonner';
import { ThemeProvider } from '@/components/theme-provider';
import { QueryProvider } from '@/components/query-provider';
import { TooltipProvider } from '@/components/ui/tooltip';
import { ServiceWorkerRegister } from '@/components/ServiceWorkerRegister';

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

// 'brand' is the stream's own palette, injected as `html.brand` by
// <StreamTheme /> on the authed pages. Registered here so next-themes treats
// it as a first-class choice a user can be switched to and can switch away
// from, rather than something bolted onto the html element behind its back.
// 'brand' is the stream's branding, 'mine' the viewer's own (see
// components/StreamTheme.tsx). Both have to be listed here or next-themes
// won't put the class on <html> at all, and the injected rules never match.
const THEMES = ['light', 'dark', 'sepia', 'contrast', 'brand', 'mine'];

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

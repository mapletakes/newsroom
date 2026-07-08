import './globals.css';
import type { Metadata } from 'next';
import { Toaster } from '@/components/ui/sonner';
import { ThemeProvider } from '@/components/theme-provider';
import { TooltipProvider } from '@/components/ui/tooltip';
import { ServiceWorkerRegister } from '@/components/ServiceWorkerRegister';

export const metadata: Metadata = {
  title: 'The Broadside — a deck for political streamers',
  description: 'Triage chat-submitted links, get DMCA risk signals, and turn your stream into show notes.',
  // iOS ignores the web manifest for home-screen icons; this covers it.
  appleWebApp: { title: 'Broadside Mod', statusBarStyle: 'default' },
  icons: { apple: '/icons/apple-touch-icon.png' },
};

const THEMES = ['light', 'dark', 'sepia', 'contrast'];

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>
        <ThemeProvider attribute="class" defaultTheme="system" enableSystem themes={THEMES}>
          <TooltipProvider delayDuration={200}>
            {children}
            <Toaster />
            <ServiceWorkerRegister />
          </TooltipProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}

'use client';

// Despite the name (kept so the 5 header call-sites don't change), this is now
// a full theme picker backed by next-themes.
import { useEffect, useState } from 'react';
import { useTheme } from 'next-themes';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Icon, type IconName } from '@/components/ui/icon';

// 'brand' is whatever the streamer set in Settings → Theme. Always offered,
// even on a stream that hasn't set one: `html.brand` with nothing injected
// simply inherits the :root palette, which IS that stream's default.
//
// 'mine' is the viewer's own, from /preferences — same deal, and offered
// unconditionally for the same reason: with nothing set it inherits :root and
// simply looks like the default, which is a truthful thing for "My theme" to
// mean before you've made one. Listing it always is also what makes the
// feature discoverable to a mod who doesn't know the page exists.
const OPTIONS: { value: string; label: string; icon: IconName }[] = [
  { value: 'brand', label: 'Stream default', icon: 'camera' },
  { value: 'mine', label: 'My theme', icon: 'bookmark' },
  { value: 'system', label: 'System', icon: 'themeSystem' },
  { value: 'light', label: 'Newsprint', icon: 'themeLight' },
  { value: 'dark', label: 'Dark', icon: 'themeDark' },
  { value: 'sepia', label: 'Sepia', icon: 'themeSepia' },
  { value: 'contrast', label: 'High contrast', icon: 'themeContrast' },
];

export function DarkModeToggle() {
  const { theme, setTheme, resolvedTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  // Until mounted, `theme` is unknown on the client — render a neutral icon to
  // avoid a hydration mismatch.
  const active = OPTIONS.find((o) => o.value === theme);
  const triggerIcon: IconName = !mounted
    ? 'themeDark'
    : active?.icon ?? (resolvedTheme === 'dark' ? 'themeDark' : 'themeLight');

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className="inline-flex items-center justify-center w-8 h-8 rounded border border-ink/20 hover:border-ink/50 transition-colors"
        aria-label="Choose theme"
        title="Choose theme"
      >
        <Icon name={triggerIcon} className="text-base" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuLabel>Theme</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {OPTIONS.map((o) => (
          <DropdownMenuItem
            key={o.value}
            onSelect={() => setTheme(o.value)}
            className={mounted && theme === o.value ? 'bg-ink text-paper' : ''}
          >
            <Icon name={o.icon} className="text-sm mr-2" />
            {o.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

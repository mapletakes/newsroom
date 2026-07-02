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

const OPTIONS: { value: string; label: string; icon: string }[] = [
  { value: 'system', label: 'System', icon: 'brightness_auto' },
  { value: 'light', label: 'Newsprint', icon: 'light_mode' },
  { value: 'dark', label: 'Dark', icon: 'dark_mode' },
  { value: 'sepia', label: 'Sepia', icon: 'local_cafe' },
  { value: 'contrast', label: 'High contrast', icon: 'contrast' },
];

export function DarkModeToggle() {
  const { theme, setTheme, resolvedTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  // Until mounted, `theme` is unknown on the client — render a neutral icon to
  // avoid a hydration mismatch.
  const active = OPTIONS.find((o) => o.value === theme);
  const triggerIcon = !mounted
    ? 'dark_mode'
    : active?.icon ?? (resolvedTheme === 'dark' ? 'dark_mode' : 'light_mode');

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className="inline-flex items-center justify-center w-8 h-8 rounded border border-ink/20 hover:border-ink/50 transition-colors"
        aria-label="Choose theme"
        title="Choose theme"
      >
        <span className="material-icons text-base">{triggerIcon}</span>
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
            <span className="material-icons text-sm mr-2">{o.icon}</span>
            {o.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

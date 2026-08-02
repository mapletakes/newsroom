'use client';

import * as React from 'react';
import { Icon, type IconName } from '@/components/ui/icon';

/**
 * The deck's left-edge launcher rail.
 *
 * Exists because the tabs used to position themselves: Links was `top-20`,
 * Questions was a `top-[184px]` computed by hand against Links' measured
 * height — and that measurement was wrong the first time, because Questions'
 * unread badge makes its own button taller than Links'. Two tabs was already
 * one magic number too many; a third would have meant tuning a pixel offset
 * against two others whose heights both vary at runtime.
 *
 * So the rail is one fixed-position flex column and the tabs are ordinary
 * children. The browser stacks them, `gap-2` spaces them, and a fourth panel
 * costs nothing.
 *
 * Each panel still owns its own <Sheet> — Radix requires the trigger to live
 * inside its own Root — which works because a Sheet renders nothing itself:
 * the trigger renders inline here, and the content portals out to the body.
 *
 * `headerHeight` is the same fix applied one level up: a hardcoded top offset
 * assumed every page's header was the same height, which broke the first time
 * a header had more nav links and a long stream name wrapped it onto three
 * lines instead of one — the rail rendered on top of the header's own wrapped
 * content instead of below it. Pass the header's live measured height (see
 * useElementHeight) instead of guessing; omit it and the rail falls back to
 * the old top-20 spot.
 */
export function DeckRail({ children, headerHeight }: { children: React.ReactNode; headerHeight?: number | null }) {
  return (
    <div
      className="fixed left-0 z-30 flex flex-col items-start gap-2"
      style={{ top: headerHeight != null ? headerHeight + 8 : '5rem' }}
    >
      {children}
    </div>
  );
}

/**
 * A rail launcher button. Deliberately has no positioning of its own — that's
 * the whole point of DeckRail — so it must be rendered inside one.
 *
 * `count`, when present and non-zero, shows an unread-style badge. This is
 * what made the old hand-tuned offsets unreliable, and is now harmless.
 */
export const RailTab = React.forwardRef<
  HTMLButtonElement,
  React.ButtonHTMLAttributes<HTMLButtonElement> & {
    icon: IconName;
    label: string;
    count?: number;
  }
>(({ icon, label, count, ...props }, ref) => (
  <button
    ref={ref}
    className="flex flex-col items-center gap-1.5 bg-ink text-paper px-1.5 py-3 rounded-r-sm shadow-lg hover:bg-rust transition-colors"
    aria-label={`Open ${label.toLowerCase()}`}
    title={label}
    {...props}
  >
    <Icon name={icon} className="text-lg" />
    <span className="[writing-mode:vertical-rl] font-mono text-[10px] uppercase tracking-widest">
      {label}
    </span>
    {!!count && (
      <span className="shrink-0 min-w-[1.25rem] h-5 px-1 flex items-center justify-center rounded-full bg-rust text-paper font-mono text-[10px] font-bold">
        {count}
      </span>
    )}
  </button>
));
RailTab.displayName = 'RailTab';

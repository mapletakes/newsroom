import { Wordmark } from './ui/wordmark';
import { DarkModeToggle } from './DarkModeToggle';
import { cn } from '@/lib/utils';

// The masthead nav row repeated across the deck, mod, settings, and admin
// pages: Wordmark, a "/ section" label, then a right-aligned nav strip
// ending in the theme picker. Layout classes (border, padding, sticky, gap)
// vary per page and stay as a pass-through className rather than baked in
// here, since e.g. the deck's sticky+left-padding (for the QuickLinksDrawer
// tab) and admin's borderless mb-8 header are both genuinely different.
export function AppHeader({
  section,
  right,
  className,
}: {
  section: React.ReactNode;
  right?: React.ReactNode;
  className?: string;
}) {
  return (
    <header className={cn('flex items-center flex-wrap', className)}>
      <Wordmark />
      <span className="font-mono text-xs uppercase tracking-widest text-ink/60">/ {section}</span>
      <div className="ml-auto flex items-center gap-4 font-mono text-xs">
        {right}
        <DarkModeToggle />
      </div>
    </header>
  );
}

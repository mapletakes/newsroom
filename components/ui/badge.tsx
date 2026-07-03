import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';

import { cn } from '@/lib/utils';

// The repeated "chip" pattern for kind/credibility/risk tags across the deck
// and mod queue. Self-contained typography (font/case/tracking), so it drops
// in regardless of whether the parent already set those classes.
export const badgeVariants = cva('font-mono uppercase tracking-widest inline-block', {
  variants: {
    variant: {
      solid: 'bg-ink text-paper',
      // Softer border — the mod queue's denser list (SubmissionCard).
      outline: 'border border-ink/40',
      // Solid border — the deck's roomier active-card panel.
      outlineStrong: 'border border-ink',
      destructive: 'bg-rust text-paper',
      warning: 'border-2 border-ochre text-ochre',
    },
    size: {
      sm: 'text-xs px-1.5 py-0.5',
      default: 'text-xs px-2 py-1',
    },
  },
  defaultVariants: { variant: 'solid', size: 'sm' },
});

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {}

// forwardRef so Radix Slot (e.g. TooltipTrigger asChild) can attach its ref
// and merged event handlers to the underlying span when Badge is wrapped.
export const Badge = React.forwardRef<HTMLSpanElement, BadgeProps>(
  ({ className, variant, size, ...props }, ref) => (
    <span ref={ref} className={cn(badgeVariants({ variant, size }), className)} {...props} />
  ),
);
Badge.displayName = 'Badge';

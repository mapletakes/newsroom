'use client';

import * as React from 'react';
import * as ToggleGroupPrimitive from '@radix-ui/react-toggle-group';
import { cva, type VariantProps } from 'class-variance-authority';

import { cn } from '@/lib/utils';

// Single-select segmented control (filters/tabs) on the broadsheet palette.
// The group gives arrow-key nav + ARIA for free regardless of variant.
const ToggleGroup = React.forwardRef<
  React.ElementRef<typeof ToggleGroupPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof ToggleGroupPrimitive.Root>
>(({ className, ...props }, ref) => (
  <ToggleGroupPrimitive.Root
    ref={ref}
    className={cn('flex flex-wrap items-center gap-1', className)}
    {...props}
  />
));
ToggleGroup.displayName = ToggleGroupPrimitive.Root.displayName;

const toggleGroupItemVariants = cva(
  'font-mono uppercase tracking-widest transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ochre focus-visible:ring-offset-2 focus-visible:ring-offset-paper',
  {
    variants: {
      variant: {
        // Bordered pill — for filtering WITHIN one list (deck's type filter).
        default:
          'border border-ink/30 px-2 py-1 hover:border-ink data-[state=on]:border-ink data-[state=on]:bg-ink data-[state=on]:text-paper',
        // Flat underline — for switching WHICH list you're looking at (mod
        // view's status filter). Reads as newspaper section tabs rather than
        // a filter toggle, on purpose: different action, different affordance.
        tab:
          'px-3 py-1.5 border-b-2 -mb-[2px] border-transparent text-ink/50 hover:text-ink data-[state=on]:border-rust data-[state=on]:text-ink data-[state=on]:font-bold',
      },
    },
    defaultVariants: { variant: 'default' },
  },
);

const ToggleGroupItem = React.forwardRef<
  React.ElementRef<typeof ToggleGroupPrimitive.Item>,
  React.ComponentPropsWithoutRef<typeof ToggleGroupPrimitive.Item> &
    VariantProps<typeof toggleGroupItemVariants>
>(({ className, variant, ...props }, ref) => (
  <ToggleGroupPrimitive.Item
    ref={ref}
    className={cn(toggleGroupItemVariants({ variant }), className)}
    {...props}
  />
));
ToggleGroupItem.displayName = ToggleGroupPrimitive.Item.displayName;

export { ToggleGroup, ToggleGroupItem };

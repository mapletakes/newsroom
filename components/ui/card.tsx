import * as React from 'react';
import { Slot } from '@radix-ui/react-slot';

import { cn } from '@/lib/utils';

// The shared card chrome (paper grain, border, hover lift — see .card-paper in
// globals.css). Padding and kind-tint are left to the caller. `asChild` lets it
// render as a button/article/anchor when the card itself is interactive.
export const Card = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement> & { asChild?: boolean }
>(({ className, asChild = false, ...props }, ref) => {
  const Comp = asChild ? Slot : 'div';
  return <Comp ref={ref} className={cn('card-paper', className)} {...props} />;
});
Card.displayName = 'Card';

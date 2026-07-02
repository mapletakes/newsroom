import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';

import { cn } from '@/lib/utils';

// Broadsheet button: mono, uppercase, tracked, sharp corners. Variants map to
// the ink/paper/rust/moss tokens. Export buttonVariants too so <Link>s can be
// styled as buttons via className without needing asChild/Slot.
export const buttonVariants = cva(
  'inline-flex items-center justify-center gap-1.5 font-mono uppercase tracking-widest transition-colors disabled:opacity-40 disabled:pointer-events-none focus-visible:outline-none',
  {
    variants: {
      variant: {
        default: 'bg-ink text-paper hover:bg-rust',
        destructive: 'bg-rust text-paper hover:opacity-90',
        outline: 'border border-ink/40 hover:bg-ink hover:text-paper',
        ghost: 'hover:bg-ink/10',
        moss: 'bg-moss text-paper hover:opacity-90',
      },
      size: {
        default: 'px-4 py-2 text-sm',
        sm: 'px-3 py-1.5 text-xs',
        lg: 'px-8 py-4 text-sm',
      },
    },
    defaultVariants: { variant: 'default', size: 'default' },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, ...props }, ref) => (
    <button ref={ref} className={cn(buttonVariants({ variant, size }), className)} {...props} />
  ),
);
Button.displayName = 'Button';

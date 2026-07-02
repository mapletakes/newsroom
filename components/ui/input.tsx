import * as React from 'react';

import { cn } from '@/lib/utils';

// Broadsheet form fields on the token palette. Width is intentionally NOT baked
// in, so callers can use `w-full` or `flex-1 min-w-0` without a class conflict.
const fieldBase =
  'border border-ink/30 bg-paper px-2 py-1.5 font-mono text-sm focus:outline-none focus:border-ink disabled:opacity-50';

export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className, ...props }, ref) => (
    <input ref={ref} className={cn(fieldBase, className)} {...props} />
  ),
);
Input.displayName = 'Input';

export const Textarea = React.forwardRef<
  HTMLTextAreaElement,
  React.TextareaHTMLAttributes<HTMLTextAreaElement>
>(({ className, ...props }, ref) => (
  <textarea ref={ref} className={cn(fieldBase, 'px-3 py-3', className)} {...props} />
));
Textarea.displayName = 'Textarea';

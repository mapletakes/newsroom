import { cn } from '@/lib/utils';

// Sharp-cornered pulsing placeholder, matching the broadsheet's square,
// no-rounded-corners look rather than the default shadcn pill shape.
export function Skeleton({ className }: { className?: string }) {
  return <div className={cn('animate-pulse bg-ink/10', className)} />;
}

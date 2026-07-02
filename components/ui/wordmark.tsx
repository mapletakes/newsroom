import Link from 'next/link';
import { cn } from '@/lib/utils';

// The masthead wordmark, linked home. Single source of truth for the brand
// name so the logo isn't copy-pasted across every page header.
export function Wordmark({ className }: { className?: string }) {
  return (
    <Link href="/" className={cn('font-display text-2xl font-black', className)}>
      The Broadside
    </Link>
  );
}

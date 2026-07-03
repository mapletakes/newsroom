'use client';

import Link from 'next/link';
import { useEventSubStatus } from '@/lib/use-eventsub-status';
import { Button } from '@/components/ui/button';

// Surfaces "chat isn't connected" on the deck itself, not just buried in
// Settings — the single most common reason nothing shows up. Silent while
// loading or connected; only renders something when there's a real problem.
export function ChatStatusBanner() {
  const { status, reconnecting, reconnect } = useEventSubStatus();

  if (status === 'loading' || status === 'connected') return null;

  return (
    <div className="bg-rust text-paper px-6 py-2 flex items-center gap-3 flex-wrap font-mono text-xs uppercase tracking-widest">
      <span>⚠ Chat isn&apos;t connected — links from chat won&apos;t be captured.</span>
      <Button
        variant="outline"
        size="xs"
        className="border-paper text-paper hover:bg-paper hover:text-rust"
        onClick={reconnect}
        disabled={reconnecting}
      >
        {reconnecting ? 'Connecting…' : 'Reconnect'}
      </Button>
      <Link href="/setup" className="underline hover:opacity-80 normal-case tracking-normal ml-auto">
        More detail in Settings →
      </Link>
    </div>
  );
}

'use client';

// EventSub connection status widget — shows whether Twitch chat is actually
// wired up, with a manual reconnect. Fully self-contained (all state comes
// from useEventSubStatus). Split out of SetupForm.tsx as a structural move
// only, no rendered output changed.

import { useEventSubStatus } from '@/lib/use-eventsub-status';
import { Button } from '@/components/ui/button';

export function EventSubStatus() {
  const { status, detail, reconnecting, reconnect } = useEventSubStatus();

  const dot =
    status === 'connected' ? 'bg-moss' :
    status === 'loading' ? 'bg-ochre animate-pulse' :
    'bg-rust';

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-3 flex-wrap">
        <span className={['inline-block w-2.5 h-2.5 rounded-full', dot].join(' ')} />
        <span className="font-mono text-sm">
          {status === 'loading' && 'Checking...'}
          {status === 'connected' && 'Twitch chat connected via EventSub'}
          {status === 'disconnected' && 'Not connected -- chat links will not be captured'}
          {status === 'error' && 'Unable to connect'}
        </span>
        {(status === 'disconnected' || status === 'error') && (
          <Button variant="outline" size="sm" onClick={reconnect} disabled={reconnecting}>
            {reconnecting ? 'Connecting...' : 'Reconnect'}
          </Button>
        )}
      </div>
      {detail && (status === 'error' || status === 'disconnected') && (
        <div className="font-mono text-xs text-rust/80 break-all">{detail}</div>
      )}
    </div>
  );
}

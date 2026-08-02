'use client';

import { useRealtimeChannel } from './use-realtime-channel';

/**
 * Subscribe to queue-change broadcasts for a stream (new link, approval,
 * reorder, now-playing switch, …). Thin wrapper over useRealtimeChannel —
 * see that file for the reconnect design rationale, which applies here too.
 */
export function useQueueRealtime(streamId: string | null, onChange: () => void) {
  useRealtimeChannel(streamId ? `queue:${streamId}` : null, onChange);
}

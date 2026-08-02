'use client';

import { useRealtimeChannel } from './use-realtime-channel';

/**
 * Subscribe to mod-availability changes for a stream. Its own topic, so a mod
 * flipping to "back in 20" refreshes the roster without making every open
 * deck refetch the submissions queue.
 */
export function useModStatusRealtime(streamId: string | null, onChange: () => void) {
  useRealtimeChannel(streamId ? `mod-status:${streamId}` : null, onChange);
}

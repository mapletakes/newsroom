'use client';

import { useRealtimeChannel } from './use-realtime-channel';

/** Subscribe to raffle-change broadcasts for a stream (someone entered,
 *  it was closed, winners were drawn or announced). Own topic, same
 *  reasoning as useQuestionsRealtime and useModStatusRealtime. */
export function useRaffleRealtime(streamId: string | null, onChange: () => void) {
  useRealtimeChannel(streamId ? `raffle:${streamId}` : null, onChange);
}

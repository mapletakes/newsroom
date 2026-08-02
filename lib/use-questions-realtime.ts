'use client';

import { useRealtimeChannel } from './use-realtime-channel';

/**
 * Subscribe to question-change broadcasts for a stream (new question landed,
 * a mod approved/rejected one, the streamer marked one answered). Separate
 * topic from useQueueRealtime's `queue:${streamId}` — a mod triaging
 * questions shouldn't refetch the whole submissions queue on every chat
 * question, and vice versa.
 */
export function useQuestionsRealtime(streamId: string | null, onChange: () => void) {
  useRealtimeChannel(streamId ? `questions:${streamId}` : null, onChange);
}

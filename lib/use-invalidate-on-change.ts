'use client';

import { useQueryClient, type QueryKey } from '@tanstack/react-query';
import { useQueueRealtime } from './use-queue-realtime';

/**
 * Wires the existing Supabase broadcast-based realtime signal straight into
 * React Query's cache invalidation. The broadcast carries no data — just a
 * "something changed" ping (see use-queue-realtime.ts) — so invalidating and
 * letting React Query refetch is the natural way to consume it; it replaces
 * every call site's own hand-rolled `refresh()` callback.
 */
export function useInvalidateOnChange(streamId: string | null, queryKey: QueryKey) {
  const queryClient = useQueryClient();
  useQueueRealtime(streamId, () => {
    queryClient.invalidateQueries({ queryKey });
  });
}

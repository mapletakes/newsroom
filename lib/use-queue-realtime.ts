'use client';

import { useEffect, useRef } from 'react';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

// Single shared browser client for Realtime. Uses the public anon key.
let browserClient: SupabaseClient | null = null;

function getBrowserClient(): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return null;
  if (!browserClient) {
    browserClient = createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return browserClient;
}

/**
 * Subscribe to queue-change broadcasts for a stream. Calls `onChange`
 * whenever the server signals the queue mutated (new link, approval,
 * reorder, etc.). This is the primary, near-instant update path; callers
 * pair it with a slow poll as a backstop, not a co-primary — this hook
 * self-heals a dropped connection on its own.
 *
 * A WebSocket subscription can silently error or time out in embedded/
 * sandboxed browser contexts (e.g. OBS's browser source) without the app
 * ever finding out. On CHANNEL_ERROR/TIMED_OUT/CLOSED this re-subscribes
 * after a short, capped exponential backoff instead of just logging and
 * going quiet until whatever poll interval the caller happens to have next
 * fires. On a successful *re*-connect (not the initial one — callers
 * already fetch on mount) it also triggers one onChange, to catch up on
 * anything missed while disconnected.
 */
export function useQueueRealtime(streamId: string | null, onChange: () => void) {
  const cb = useRef(onChange);
  useEffect(() => {
    cb.current = onChange;
  }, [onChange]);

  useEffect(() => {
    if (!streamId) return;
    const sb = getBrowserClient();
    if (!sb) return;

    let channel: ReturnType<typeof sb.channel> | null = null;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let stopped = false;
    let attempt = 0;

    const connect = () => {
      if (stopped) return;
      channel = sb
        .channel(`queue:${streamId}`)
        .on('broadcast', { event: 'changed' }, () => cb.current())
        .subscribe((status) => {
          if (status === 'SUBSCRIBED') {
            if (attempt > 0) cb.current(); // catch up after a reconnect
            attempt = 0;
            return;
          }
          if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
            console.warn(`Realtime channel queue:${streamId} — ${status}, reconnecting…`);
            if (channel) sb.removeChannel(channel);
            if (stopped) return;
            attempt += 1;
            const delay = Math.min(1000 * 2 ** attempt, 30000);
            retryTimer = setTimeout(connect, delay);
          }
        });
    };

    connect();

    return () => {
      stopped = true;
      if (retryTimer) clearTimeout(retryTimer);
      if (channel) sb.removeChannel(channel);
    };
  }, [streamId]);
}

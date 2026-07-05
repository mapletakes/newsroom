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
 * reorder, etc.). Callers pair this with a slow poll as a backstop.
 *
 * Deliberately does NOT attempt to auto-reconnect on error/timeout/close: an
 * earlier version did, and a single dropped connection could fire more than
 * one error-type status (Phoenix channels commonly emit CHANNEL_ERROR then
 * CLOSED for one failure), each independently scheduling its own retry
 * timer. Since only the most recently scheduled timer was tracked, earlier
 * ones leaked and fired anyway — and every successful reconnect calls
 * onChange, which hits the REST API. That compounded into a runaway flood of
 * requests. Simple logging + relying on the caller's poll to recover is the
 * safe, boring choice here.
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

    const channel = sb
      .channel(`queue:${streamId}`)
      .on('broadcast', { event: 'changed' }, () => cb.current())
      .subscribe((status) => {
        // Visibility only — no auto-retry (see doc comment above). The
        // caller's own poll interval is what recovers from a dropped
        // subscription.
        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
          console.warn(`Realtime channel queue:${streamId} — ${status}`);
        }
      });

    return () => {
      sb.removeChannel(channel);
    };
  }, [streamId]);
}

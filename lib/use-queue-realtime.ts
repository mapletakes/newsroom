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
 * reorder, etc.). Replaces timer-based polling.
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
        // Visibility for embedded/sandboxed contexts (e.g. OBS's browser
        // source) where a WebSocket subscription can silently fail to
        // connect or drop without erroring — previously undetectable short
        // of waiting out a fallback poll.
        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
          console.warn(`Realtime channel queue:${streamId} — ${status}`);
        }
      });

    return () => {
      sb.removeChannel(channel);
    };
  }, [streamId]);
}

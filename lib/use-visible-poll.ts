'use client';

import { useEffect, useRef } from 'react';

/**
 * Run `onTick` every `intervalMs`, but only while the tab is visible.
 *
 * Pauses the timer when the tab is hidden (so a backgrounded tab makes no
 * requests at all) and fires once immediately when the tab returns to the
 * foreground, to catch up. Intended as a lightweight fallback alongside
 * realtime broadcasts — not the primary update path.
 */
export function useVisiblePoll(onTick: () => void, intervalMs: number) {
  const cb = useRef(onTick);
  useEffect(() => {
    cb.current = onTick;
  }, [onTick]);

  useEffect(() => {
    let id: ReturnType<typeof setInterval> | null = null;
    const start = () => {
      if (id === null) id = setInterval(() => cb.current(), intervalMs);
    };
    const stop = () => {
      if (id !== null) {
        clearInterval(id);
        id = null;
      }
    };
    const onVisibility = () => {
      if (document.visibilityState === 'visible') {
        cb.current(); // catch up on whatever was missed while hidden
        start();
      } else {
        stop();
      }
    };

    if (document.visibilityState === 'visible') start();
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      stop();
    };
  }, [intervalMs]);
}

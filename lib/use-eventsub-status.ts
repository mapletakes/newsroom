'use client';

import { useEffect, useState } from 'react';

export type EventSubStatus = 'loading' | 'connected' | 'disconnected' | 'error';

/**
 * Checks (and can reconnect) this streamer's Twitch chat EventSub subscription.
 * Shared by the Settings status widget and the deck's "chat not connected"
 * banner, so there's one source of truth for what "connected" means.
 */
export function useEventSubStatus() {
  const [status, setStatus] = useState<EventSubStatus>('loading');
  const [detail, setDetail] = useState<string | null>(null);
  const [reconnecting, setReconnecting] = useState(false);

  const check = async () => {
    try {
      const r = await fetch('/api/twitch/eventsub/status');
      if (!r.ok) { setStatus('error'); setDetail('HTTP ' + r.status); return; }
      const data = await r.json();
      setStatus(data.connected ? 'connected' : 'disconnected');
      if (!data.connected && data.status && data.status !== 'none') {
        setDetail('Subscription status: ' + data.status);
      } else {
        setDetail(null);
      }
    } catch {
      setStatus('error');
    }
  };

  useEffect(() => { check(); }, []);

  const reconnect = async () => {
    setReconnecting(true);
    setDetail(null);
    try {
      const r = await fetch('/api/twitch/eventsub/status', { method: 'POST' });
      const data = await r.json();
      if (data.error) {
        setDetail(data.error);
        setStatus('error');
      } else if (data.ok) {
        setDetail('Callback: ' + data.callbackUrl);
        await new Promise((resolve) => setTimeout(resolve, 3000));
        await check();
      }
    } catch (err) {
      setDetail(String(err));
      setStatus('error');
    } finally {
      setReconnecting(false);
    }
  };

  return { status, detail, reconnecting, reconnect, check };
}

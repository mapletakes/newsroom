'use client';

import { useCallback, useEffect, useState } from 'react';
import { useQueueRealtime } from '@/lib/use-queue-realtime';
import { formatDuration } from '@/lib/url';

type NowPlaying = {
  title: string;
  kind: string;
  publisher: string | null;
  credibility: string | null;
  durationSeconds: number | null;
};

// The on-air lower third: a broadsheet card (paper, ink border, hard shadow)
// styled after the mod view's "On air" bar, kept under 100px tall so it works
// as a slim OBS browser source. Disappears entirely between items.
export function OverlayView({ token }: { token: string }) {
  const [streamId, setStreamId] = useState<string | null>(null);
  const [nowPlaying, setNowPlaying] = useState<NowPlaying | null>(null);
  const [invalid, setInvalid] = useState(false);

  const refresh = useCallback(async () => {
    if (!token) return;
    try {
      const r = await fetch(`/api/deck/overlay?token=${encodeURIComponent(token)}`);
      if (r.status === 401 || r.status === 400) {
        setInvalid(true);
        setNowPlaying(null);
        return;
      }
      if (!r.ok) return; // transient server error — keep showing what we have
      const data = await r.json();
      setInvalid(false);
      setStreamId(data.streamId || null);
      setNowPlaying(data.nowPlaying || null);
    } catch {
      // network blip — keep the current card rather than flickering it away
    }
  }, [token]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // Realtime pings when the deck changes (including now-playing switches),
  // with a slow interval as the fallback. OBS's embedded browser always
  // reports itself visible, so a plain interval is fine here.
  useQueueRealtime(streamId, refresh);
  useEffect(() => {
    const id = setInterval(refresh, 60000);
    return () => clearInterval(id);
  }, [refresh]);

  // Setup aid only: a misconfigured source shows a small chip instead of
  // silent nothing. (Streamers see this while configuring, not on air.)
  if (invalid) {
    return (
      <div className="inline-flex items-center gap-2 m-2 border border-rust bg-paper px-3 py-1.5 font-mono text-xs text-rust">
        The Broadside overlay: invalid or missing token — regenerate it in Settings → Quick add.
      </div>
    );
  }

  if (!nowPlaying) return null;

  const meta = [
    nowPlaying.publisher,
    nowPlaying.kind.replace('_', ' '),
    nowPlaying.durationSeconds ? formatDuration(nowPlaying.durationSeconds) : null,
    nowPlaying.credibility,
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <div className="m-2 h-[84px] flex items-center gap-4 bg-paper border-2 border-ink shadow-[4px_4px_0_rgb(var(--ink))] px-4 overflow-hidden">
      <div className="shrink-0 flex flex-col items-center gap-1">
        <span className="flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-widest text-rust font-bold">
          <span className="inline-block w-2 h-2 rounded-full bg-rust live-dot" />
          On air
        </span>
        <span className="font-mono text-[8px] uppercase tracking-widest text-ink/40">
          The Broadside
        </span>
      </div>
      <div className="shrink-0 w-px self-stretch my-3 bg-ink/20" />
      <div className="min-w-0 flex-1">
        <div className="font-display text-xl font-bold leading-tight truncate">
          {nowPlaying.title}
        </div>
        {meta && (
          <div className="font-mono text-[11px] uppercase tracking-widest text-ink/60 truncate mt-0.5">
            {meta}
          </div>
        )}
      </div>
    </div>
  );
}

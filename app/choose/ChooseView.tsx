'use client';

import { useEffect, useRef, useState } from 'react';
import { Wordmark } from '@/components/ui/wordmark';
import type { ChannelOption } from '@/lib/mod-channels';

// What the check on load had to say. Quiet unless it found something or can't
// work at all — nobody asked for it, so "nothing new" and "Twitch hiccuped"
// aren't worth interrupting anyone with.
type Notice = { kind: 'none' } | { kind: 'found'; names: string[] } | { kind: 'reconnect' };

export function ChooseView({
  displayName,
  ownStream,
  modStreams,
}: {
  displayName: string;
  ownStream: ChannelOption | null;
  modStreams: ChannelOption[];
}) {
  const [mods, setMods] = useState(modStreams);
  const [checking, setChecking] = useState(true);
  const [notice, setNotice] = useState<Notice>({ kind: 'none' });
  const knownIds = useRef(new Set(modStreams.map((s) => s.id)));

  const switchTo = async (streamId: string, role: 'streamer' | 'mod', dest: string) => {
    await fetch('/api/auth/switch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ streamId, role }),
    });
    window.location.href = dest;
  };

  // The server-rendered list is only what was recorded at sign-in, so a
  // channel someone started modding afterwards isn't in it. Asking Twitch
  // again on load fixes that without making anyone log out and back in.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch('/api/auth/refresh-channels', { method: 'POST' });
        const data = await r.json().catch(() => ({}));
        if (cancelled) return;
        if (r.ok && Array.isArray(data.channels)) {
          const channels = data.channels as ChannelOption[];
          const added = channels.filter((c) => !knownIds.current.has(c.id));
          knownIds.current = new Set(channels.map((c) => c.id));
          setMods(channels);
          if (added.length > 0) setNotice({ kind: 'found', names: added.map((c) => c.name) });
        } else if (data.error === 'reconnect') {
          setNotice({ kind: 'reconnect' });
        }
      } catch {
        /* keep showing the list we have */
      } finally {
        if (!cancelled) setChecking(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="min-h-screen px-6 py-10 max-w-2xl mx-auto">
      <header className="mb-8">
        <Wordmark />
      </header>

      <h1 className="font-display text-4xl font-bold mb-2">Welcome, {displayName}</h1>
      <p className="text-ink/60 mb-2">Choose how you want to use The Broadside.</p>
      <div className="rule-double mb-8" />

      {ownStream && (
        <section className="mb-10">
          <h2 className="font-display text-2xl font-bold mb-4">Your channel</h2>
          <button
            onClick={() => switchTo(ownStream.id, 'streamer', '/deck')}
            className="w-full text-left card-paper p-5 hover:border-ink"
          >
            <div className="font-display text-xl font-bold">{ownStream.name}</div>
            <div className="font-mono text-xs text-ink/60 mt-1">Open streamer deck for your own stream</div>
          </button>
        </section>
      )}

      <section>
        <h2 className="font-display text-2xl font-bold mb-4">Channels you moderate</h2>

        {mods.length > 0 ? (
          <div className="space-y-3">
            {mods.map((s) => (
              <button
                key={s.id}
                onClick={() => switchTo(s.id, 'mod', '/mod')}
                className="w-full text-left card-paper p-5 hover:border-ink"
              >
                <div className="font-display text-xl font-bold">{s.name}</div>
                <div className="font-mono text-xs text-ink/60 mt-1">
                  Open mod triage for #{s.login}
                </div>
              </button>
            ))}
          </div>
        ) : (
          // Don't claim "none" while the check that might find some is still
          // running — it would flash a wrong answer before the right one.
          <p className="text-ink/60">{checking ? 'Checking Twitch…' : 'No channels yet.'}</p>
        )}

        <div role="status" aria-live="polite" aria-busy={checking} className="mt-4 text-sm">
          {notice.kind === 'found' && (
            <p className="text-moss">
              Found {notice.names.length === 1 ? 'a new channel' : `${notice.names.length} new channels`}:{' '}
              {notice.names.join(', ')}
            </p>
          )}
          {notice.kind === 'reconnect' && (
            <p className="text-rust">
              Twitch won&apos;t let us check for new channels with your current sign-in.{' '}
              <a href="/api/twitch/oauth" className="underline hover:text-ink">
                Reconnect Twitch
              </a>{' '}
              to refresh the list.
            </p>
          )}
        </div>

        <p className="font-mono text-xs text-ink/50 mt-4">
          A channel appears here once its streamer has signed in to The Broadside and you moderate it on Twitch.
        </p>
      </section>
    </div>
  );
}

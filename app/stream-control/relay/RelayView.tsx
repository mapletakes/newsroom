'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { AppHeader } from '@/components/AppHeader';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { RELAY_HEARTBEAT_MS, type ControlSnapshot } from '@/lib/stream-control-shared';
import { useRealtimeChannel } from '@/lib/use-realtime-channel';
import { createRelay, type RelayLogEntry, type RelayPhase } from './relay';

// How often the relay checks for queued commands when no realtime ping has
// arrived. Pings are the normal path; this only covers a dropped subscription.
const CLAIM_POLL_MS = 10_000;
const MAX_LOG = 30;

const tokenKey = (streamId: string) => `broadside:stream-control:token:${streamId}`;

const PHASE_LABEL: Record<RelayPhase, string> = {
  idle: 'Not connected',
  connecting: 'Connecting…',
  connected: 'Connected to Streamlabs',
  retrying: 'Reconnecting…',
  error: 'Not connected',
};

const PHASE_TONE: Record<RelayPhase, string> = {
  idle: 'text-ink/60',
  connecting: 'text-ochre',
  connected: 'text-moss',
  retrying: 'text-ochre',
  error: 'text-rust',
};

export function RelayView({ streamId }: { streamId: string }) {
  const [token, setToken] = useState('');
  const [remember, setRemember] = useState(true);
  const [phase, setPhase] = useState<RelayPhase>('idle');
  const [error, setError] = useState<string | null>(null);
  const [snapshot, setSnapshot] = useState<ControlSnapshot | null>(null);
  const [synced, setSynced] = useState<boolean | null>(null);
  const [log, setLog] = useState<RelayLogEntry[]>([]);

  const [relay] = useState(() =>
    createRelay({
      onPhase: (p, e) => {
        setPhase(p);
        setError(e);
      },
      onSnapshot: setSnapshot,
      onSync: setSynced,
      onLog: (entry) => setLog((l) => [entry, ...l].slice(0, MAX_LOG)),
    }),
  );

  // A remembered token connects straight away, so reopening this tab before a
  // stream is all the setup there is.
  useEffect(() => {
    const saved = localStorage.getItem(tokenKey(streamId));
    if (saved) {
      setToken(saved);
      relay.start(saved);
    }
    return () => relay.stop();
  }, [relay, streamId]);

  useEffect(() => {
    // Heartbeat whether or not Streamlabs is up: mods should see "relay open,
    // Streamlabs closed" rather than "relay gone".
    void relay.heartbeat();
    const beat = setInterval(() => void relay.heartbeat(), RELAY_HEARTBEAT_MS);
    const poll = setInterval(() => void relay.claim(), CLAIM_POLL_MS);
    // Closing the tab: say so at once rather than letting mods wait out the
    // offline window. sendBeacon carries the session cookie like fetch.
    const onUnload = () =>
      navigator.sendBeacon(
        '/api/stream-control/relay/state',
        new Blob([JSON.stringify({ connected: false })], { type: 'application/json' }),
      );
    window.addEventListener('pagehide', onUnload);
    return () => {
      clearInterval(beat);
      clearInterval(poll);
      window.removeEventListener('pagehide', onUnload);
    };
  }, [relay]);

  useRealtimeChannel(`stream-control-relay:${streamId}`, () => void relay.claim());

  const connect = () => {
    const t = token.trim();
    if (!t) return;
    if (remember) localStorage.setItem(tokenKey(streamId), t);
    else localStorage.removeItem(tokenKey(streamId));
    relay.start(t);
  };

  const disconnect = () => relay.stop();

  const forget = () => {
    relay.stop();
    localStorage.removeItem(tokenKey(streamId));
    setToken('');
  };

  const active = snapshot?.scenes.find((s) => s.id === snapshot.activeSceneId);
  const running = phase === 'connected' || phase === 'connecting' || phase === 'retrying';

  return (
    <div className="min-h-screen flex flex-col">
      <AppHeader
        className="border-b-2 border-ink px-6 py-3 gap-6"
        section="stream control relay"
        right={
          <>
            <Link href="/stream-control" className="underline hover:text-rust">
              Control Panel
            </Link>
            <Link href="/setup" className="underline hover:text-rust">
              Settings
            </Link>
          </>
        }
      />
      <main className="px-6 py-8 max-w-2xl w-full mx-auto space-y-8">
        <section>
          <h1 className="font-display text-3xl font-bold mb-2">Stream control relay</h1>
          <p className="text-ink/70 leading-relaxed max-w-prose">
            Keep this tab open on the PC that runs Streamlabs while you stream. It passes your mods&apos;
            scene switches and show/hide requests to Streamlabs. It can only do those two things: nothing
            sent through it can delete, rename, go live or end your stream.
          </p>
        </section>

        <section className="border-2 border-ink p-4 space-y-3">
          <div className="flex items-baseline justify-between gap-4 flex-wrap">
            <p className={`font-mono text-sm uppercase tracking-widest ${PHASE_TONE[phase]}`} role="status">
              {PHASE_LABEL[phase]}
            </p>
            {synced === false && (
              <p className="font-mono text-xs text-rust">Can&apos;t reach Broadside, retrying</p>
            )}
          </div>
          {error && <p className="text-sm text-rust">{error}</p>}
          {phase === 'connected' && snapshot && (
            <p className="text-sm text-ink/70">
              Live scene: <strong>{active?.name || 'none'}</strong> · {snapshot.scenes.length} scenes visible to
              your mods
            </p>
          )}
        </section>

        <section className="space-y-3">
          <label className="block">
            <span className="font-mono text-xs uppercase tracking-widest text-ink/60">Streamlabs token</span>
            <Input
              type="password"
              autoComplete="off"
              spellCheck={false}
              value={token}
              onChange={(e) => setToken(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && connect()}
              placeholder="Paste from Streamlabs"
              className="mt-1"
            />
          </label>
          <p className="text-xs text-ink/60 leading-relaxed max-w-prose">
            In Streamlabs: Settings → Remote Control, click the QR code, then Show details. This token gives full
            control of Streamlabs, so it never leaves this browser: Broadside&apos;s servers never see it.
          </p>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
            Remember it in this browser and connect automatically
          </label>
          <div className="flex gap-2 flex-wrap">
            <Button onClick={connect} disabled={!token.trim()}>
              {running ? 'Reconnect' : 'Connect'}
            </Button>
            {running && (
              <Button variant="outline" onClick={disconnect}>
                Disconnect
              </Button>
            )}
            <Button variant="ghost" onClick={forget}>
              Forget token
            </Button>
          </div>
        </section>

        <section>
          <h2 className="font-mono text-xs uppercase tracking-widest text-ink/60 mb-2">Recent activity</h2>
          {log.length === 0 ? (
            <p className="text-sm text-ink/50">Nothing yet.</p>
          ) : (
            <ul className="space-y-1 text-sm">
              {log.map((entry, i) => (
                <li
                  key={`${entry.at}-${i}`}
                  className={entry.tone === 'bad' ? 'text-rust' : entry.tone === 'ok' ? 'text-ink' : 'text-ink/60'}
                >
                  <span className="font-mono text-xs text-ink/50 mr-2">
                    {new Date(entry.at).toLocaleTimeString()}
                  </span>
                  {entry.text}
                </li>
              ))}
            </ul>
          )}
        </section>
      </main>
    </div>
  );
}

'use client';

// Stream control settings: which mods may switch scenes and which may show or
// hide sources, links to the relay and the panel, and the record of what was
// done. Only rendered while the module is on for this channel.

import Link from 'next/link';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { queryKeys } from '@/lib/query-keys';
import { describeCommand, type ControlRecord } from '@/lib/stream-control-shared';

export type ControlModerator = {
  twitchUserId: string;
  login: string;
  canSwitchScenes: boolean;
  canToggleSources: boolean;
};

type Grant = 'canSwitchScenes' | 'canToggleSources';

async function fetchLog(): Promise<ControlRecord[]> {
  const r = await fetch('/api/stream-control/commands', { cache: 'no-store' });
  if (!r.ok) throw new Error(`Couldn't load the log (${r.status})`);
  return (await r.json()).commands;
}

const STATUS_TONE: Record<ControlRecord['status'], string> = {
  pending: 'text-ochre',
  running: 'text-ochre',
  done: 'text-moss',
  failed: 'text-rust',
  expired: 'text-ink/50',
};

export function StreamControlSettings({ initial }: { initial: ControlModerator[] }) {
  const [mods, setMods] = useState(initial);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showLog, setShowLog] = useState(false);

  const { data: log, error: logError, isFetching } = useQuery({
    queryKey: queryKeys.streamControlLog(),
    queryFn: fetchLog,
    enabled: showLog,
  });

  const set = async (twitchUserId: string, grant: Grant, value: boolean) => {
    setBusy(twitchUserId);
    setError(null);
    const r = await fetch('/api/curators', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ twitchUserId, [grant]: value }),
    }).catch(() => null);
    setBusy(null);
    if (r?.ok) setMods((ms) => ms.map((m) => (m.twitchUserId === twitchUserId ? { ...m, [grant]: value } : m)));
    else setError("Couldn't save that change. Try again.");
  };

  return (
    <div className="space-y-6">
      <div className="text-sm text-ink/70 leading-relaxed max-w-prose space-y-2">
        <p>
          Let mods switch your Streamlabs scenes and show or hide sources in the live scene. They can&apos;t
          delete, rename or add anything, and they can&apos;t go live or end your stream.
        </p>
        <p>
          It works through the{' '}
          <Link href="/stream-control/relay" className="underline hover:text-rust">
            relay
          </Link>
          : keep it open on the PC that runs Streamlabs while you stream. You and your mods use the{' '}
          <Link href="/stream-control" className="underline hover:text-rust">
            control panel
          </Link>
          .
        </p>
      </div>

      {mods.length === 0 ? (
        <p className="font-mono text-xs text-ink/50">No mods have signed in yet.</p>
      ) : (
        <table className="text-sm">
          <thead>
            <tr className="font-mono text-[10px] uppercase tracking-widest text-ink/60 text-left">
              <th className="pr-6 pb-2 font-normal">Mod</th>
              <th className="pr-6 pb-2 font-normal">Switch scenes</th>
              <th className="pb-2 font-normal">Show/hide sources</th>
            </tr>
          </thead>
          <tbody>
            {mods.map((m) => (
              <tr key={m.twitchUserId}>
                <td className="pr-6 py-1 font-mono">{m.login}</td>
                <td className="pr-6 py-1">
                  <input
                    type="checkbox"
                    checked={m.canSwitchScenes}
                    disabled={busy === m.twitchUserId}
                    onChange={(e) => set(m.twitchUserId, 'canSwitchScenes', e.target.checked)}
                    aria-label={`${m.login} can switch scenes`}
                  />
                </td>
                <td className="py-1">
                  <input
                    type="checkbox"
                    checked={m.canToggleSources}
                    disabled={busy === m.twitchUserId}
                    onChange={(e) => set(m.twitchUserId, 'canToggleSources', e.target.checked)}
                    aria-label={`${m.login} can show and hide sources`}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {error && <p className="font-mono text-xs text-rust">{error}</p>}

      <div>
        <button
          type="button"
          className="font-mono text-xs uppercase tracking-widest underline hover:text-rust"
          onClick={() => setShowLog((v) => !v)}
          aria-expanded={showLog}
        >
          {showLog ? 'Hide' : 'Show'} what mods have done
        </button>
        {showLog && (
          <div className="mt-3">
            {logError ? (
              <p className="text-sm text-rust">{(logError as Error).message}</p>
            ) : !log ? (
              <p className="text-sm text-ink/50">{isFetching ? 'Loading…' : ''}</p>
            ) : log.length === 0 ? (
              <p className="text-sm text-ink/50">Nothing in the last 30 days.</p>
            ) : (
              <ul className="space-y-1 text-sm max-h-80 overflow-y-auto">
                {log.map((rec) => (
                  <li key={rec.id}>
                    <span className="font-mono text-xs text-ink/50 mr-2">
                      {new Date(rec.createdAt).toLocaleString()}
                    </span>
                    <strong>{rec.actorLogin}</strong>: {describeCommand(rec, null)}{' '}
                    <span className={`font-mono text-[10px] uppercase tracking-widest ${STATUS_TONE[rec.status]}`}>
                      {rec.status}
                    </span>
                    {rec.error && <span className="text-rust"> ({rec.error})</span>}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

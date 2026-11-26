'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AppHeader } from '@/components/AppHeader';
import { Button } from '@/components/ui/button';
import { queryKeys } from '@/lib/query-keys';
import {
  describeCommand,
  type ControlCommand,
  type ControlItem,
  type ControlRecord,
  type ControlView,
} from '@/lib/stream-control-shared';
import { useRealtimeChannel } from '@/lib/use-realtime-channel';

// Backstop for a dropped realtime subscription; pings are the normal path.
const POLL_MS = 15_000;
// How long a scene button stays armed after the first tap.
const ARM_MS = 4000;

const ERRORS: Record<string, string> = {
  'relay-offline': "The streamer's relay isn't running, so nothing can reach Streamlabs right now.",
  'streamlabs-disconnected': "The relay is open but can't reach Streamlabs right now.",
  'not-live-scene': 'The scene changed before that went through. Check the sources again.',
  'unknown-scene': 'That scene no longer exists.',
  'unknown-source': 'That source is no longer in the scene.',
  'rate-limited': 'Slow down a little. Try again in a few seconds.',
  forbidden: "You don't have permission for that.",
};

async function fetchView(): Promise<ControlView> {
  const r = await fetch('/api/stream-control/state', { cache: 'no-store' });
  if (!r.ok) throw new Error(`Couldn't load stream control (${r.status})`);
  return r.json();
}

async function sendCommand(command: ControlCommand): Promise<void> {
  const r = await fetch('/api/stream-control/commands', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(command),
  });
  if (!r.ok) {
    const e = await r.json().catch(() => ({}));
    throw new Error(ERRORS[e.error] || e.error || `Request failed (${r.status})`);
  }
}

const inFlight = (rec: ControlRecord) => rec.status === 'pending' || rec.status === 'running';

const STATUS_LABEL: Record<ControlRecord['status'], string> = {
  pending: 'queued',
  running: 'running',
  done: 'done',
  failed: 'failed',
  expired: 'expired',
};

const STATUS_TONE: Record<ControlRecord['status'], string> = {
  pending: 'text-ochre',
  running: 'text-ochre',
  done: 'text-moss',
  failed: 'text-rust',
  expired: 'text-ink/50',
};

/** Items in display order with their folder depth: each folder is followed by
 *  what's inside it. Anything whose folder is missing shows at the top level
 *  rather than disappearing. */
export function orderItems(items: ControlItem[]): { item: ControlItem; depth: number }[] {
  const ids = new Set(items.map((i) => i.id));
  const out: { item: ControlItem; depth: number }[] = [];
  const seen = new Set<string>();
  const walk = (parentId: string | null, depth: number) => {
    for (const item of items) {
      const parent = item.parentId && ids.has(item.parentId) ? item.parentId : null;
      if (parent !== parentId || seen.has(item.id)) continue;
      seen.add(item.id);
      out.push({ item, depth });
      if (item.type === 'folder') walk(item.id, depth + 1);
    }
  };
  walk(null, 0);
  return out;
}

export function StreamControlView({
  streamId,
  channel,
  isMod,
}: {
  streamId: string;
  channel: string | null;
  isMod: boolean;
}) {
  const queryClient = useQueryClient();
  const key = queryKeys.streamControl();
  const { data, error: loadError } = useQuery({
    queryKey: key,
    queryFn: fetchView,
    refetchInterval: POLL_MS,
    refetchOnWindowFocus: true,
  });
  useRealtimeChannel(`stream-control:${streamId}`, () => queryClient.invalidateQueries({ queryKey: key }));

  const [actionError, setActionError] = useState<string | null>(null);
  const mutation = useMutation({
    mutationFn: sendCommand,
    onMutate: () => setActionError(null),
    onError: (e: Error) => setActionError(e.message),
    onSettled: () => queryClient.invalidateQueries({ queryKey: key }),
  });

  const [armed, setArmed] = useState<string | null>(null);
  useEffect(() => {
    if (!armed) return;
    const t = setTimeout(() => setArmed(null), ARM_MS);
    return () => clearTimeout(t);
  }, [armed]);

  const snapshot = data?.snapshot ?? null;
  const live = snapshot?.scenes.find((s) => s.id === snapshot.activeSceneId) ?? null;
  const usable = !!data?.relayOnline && !!data?.streamlabsConnected;
  const canSwitch = usable && !!data?.access.canSwitchScenes;
  const canToggle = usable && !!data?.access.canToggleSources;
  const pending = (data?.recent ?? []).filter(inFlight);
  const switchPending = pending.some((r) => r.kind === 'switch_scene');
  const itemPending = (itemId: string) =>
    pending.some((r) => r.kind === 'set_visibility' && r.args.itemId === itemId);

  const pressScene = (sceneId: string) => {
    if (armed !== sceneId) {
      setArmed(sceneId);
      return;
    }
    setArmed(null);
    mutation.mutate({ kind: 'switch_scene', args: { sceneId } });
  };

  const toggle = (item: ControlItem) => {
    if (!live) return;
    mutation.mutate({ kind: 'set_visibility', args: { sceneId: live.id, itemId: item.id, visible: !item.visible } });
  };

  return (
    <div className="min-h-screen flex flex-col">
      <AppHeader
        className="border-b-2 border-ink px-6 py-3 gap-6"
        section="stream control"
        right={
          <>
            {channel && <span className="uppercase tracking-widest">#{channel}</span>}
            <Link href={isMod ? '/mod' : '/deck'} className="underline hover:text-rust">
              {isMod ? 'Mod View' : 'Deck'}
            </Link>
            {!isMod && (
              <Link href="/stream-control/relay" className="underline hover:text-rust">
                Relay
              </Link>
            )}
          </>
        }
      />
      <main className="px-6 py-6 max-w-3xl w-full mx-auto space-y-8">
        {loadError && <p className="text-rust">{(loadError as Error).message}</p>}

        {data && !data.relayOnline && (
          <p className="border-2 border-rust text-rust p-3 text-sm" role="status">
            The streamer&apos;s relay isn&apos;t running, so controls are off.
            {isMod ? ' Ask the streamer to open it.' : ' Open the relay page on your streaming PC.'}
          </p>
        )}
        {data?.relayOnline && !data.streamlabsConnected && (
          <p className="border-2 border-ochre p-3 text-sm" role="status">
            The relay is open but can&apos;t reach Streamlabs, so controls are off.
          </p>
        )}
        {actionError && (
          <p className="border-2 border-rust text-rust p-3 text-sm" role="alert">
            {actionError}
          </p>
        )}

        <section>
          <h2 className="font-mono text-xs uppercase tracking-widest text-ink/60 mb-3">Scenes</h2>
          {!snapshot || snapshot.scenes.length === 0 ? (
            <p className="text-sm text-ink/50">{data ? 'No scenes reported yet.' : 'Loading…'}</p>
          ) : (
            <>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                {snapshot.scenes.map((scene) => {
                  const isLive = scene.id === snapshot.activeSceneId;
                  const isArmed = armed === scene.id;
                  return (
                    <button
                      key={scene.id}
                      type="button"
                      disabled={isLive || !canSwitch || switchPending}
                      onClick={() => pressScene(scene.id)}
                      aria-pressed={isLive}
                      className={
                        'text-left px-3 py-3 border-2 transition-colors disabled:cursor-default ' +
                        (isLive
                          ? 'bg-ink text-paper border-ink'
                          : isArmed
                            ? 'bg-rust text-paper border-rust'
                            : 'border-ink/30 hover:border-ink disabled:opacity-50 disabled:hover:border-ink/30')
                      }
                    >
                      <span className="block font-medium truncate">{scene.name || 'Untitled scene'}</span>
                      <span className="block font-mono text-[10px] uppercase tracking-widest mt-1 opacity-80">
                        {isLive ? 'Live' : isArmed ? 'Tap again to switch' : ' '}
                      </span>
                    </button>
                  );
                })}
              </div>
              {data?.access.canSwitchScenes ? (
                <p className="text-xs text-ink/50 mt-2">Tap a scene twice to switch to it.</p>
              ) : (
                <p className="text-xs text-ink/50 mt-2">You can see scenes but not switch them.</p>
              )}
            </>
          )}
        </section>

        {live && (
          <section>
            <h2 className="font-mono text-xs uppercase tracking-widest text-ink/60 mb-3">
              Sources in {live.name || 'the live scene'}
            </h2>
            {live.items.length === 0 ? (
              <p className="text-sm text-ink/50">This scene has no sources.</p>
            ) : (
              <ul className="divide-y divide-ink/10 border-y border-ink/10">
                {orderItems(live.items).map(({ item, depth }) => (
                  <li
                    key={item.id}
                    className="flex items-center gap-3 py-2"
                    style={{ paddingLeft: `${depth * 1.25}rem` }}
                  >
                    {item.type === 'folder' ? (
                      <span className="font-mono text-xs uppercase tracking-widest text-ink/60">
                        {item.name || 'Folder'}
                      </span>
                    ) : (
                      <>
                        <span className={'flex-1 truncate ' + (item.visible ? '' : 'text-ink/40 line-through')}>
                          {item.name || 'Untitled source'}
                        </span>
                        <span className="font-mono text-[10px] uppercase tracking-widest text-ink/50">
                          {itemPending(item.id) ? 'working…' : item.visible ? 'visible' : 'hidden'}
                        </span>
                        {data?.access.canToggleSources && (
                          <Button
                            size="xs"
                            variant={item.visible ? 'outline' : 'default'}
                            disabled={!canToggle || itemPending(item.id)}
                            onClick={() => toggle(item)}
                            aria-label={`${item.visible ? 'Hide' : 'Show'} ${item.name}`}
                          >
                            {item.visible ? 'Hide' : 'Show'}
                          </Button>
                        )}
                      </>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}

        <section>
          <h2 className="font-mono text-xs uppercase tracking-widest text-ink/60 mb-3">Recent</h2>
          {(data?.recent ?? []).length === 0 ? (
            <p className="text-sm text-ink/50">Nothing yet.</p>
          ) : (
            <ul className="space-y-1 text-sm">
              {data!.recent.map((rec) => (
                <li key={rec.id}>
                  <span className="font-mono text-xs text-ink/50 mr-2">
                    {new Date(rec.createdAt).toLocaleTimeString()}
                  </span>
                  <strong>{rec.actorLogin}</strong>: {describeCommand(rec, snapshot)}{' '}
                  <span className={`font-mono text-[10px] uppercase tracking-widest ${STATUS_TONE[rec.status]}`}>
                    {STATUS_LABEL[rec.status]}
                  </span>
                  {rec.error && <span className="text-rust"> ({rec.error})</span>}
                </li>
              ))}
            </ul>
          )}
        </section>
      </main>
    </div>
  );
}

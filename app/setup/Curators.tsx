'use client';

// Deck curators panel — lets the streamer grant a mod curate access (and,
// separately, the narrower can_set_now_playing) without controlling live
// playback. Fully self-contained (own state, own fetch calls); split out of
// SetupForm.tsx as a structural move only, no rendered output changed.

import { useState } from 'react';

export type Moderator = { twitchUserId: string; login: string; canCurate: boolean; canSetNowPlaying: boolean };

export function Curators({ initial }: { initial: Moderator[] }) {
  const [mods, setMods] = useState(initial);
  const [busy, setBusy] = useState<string | null>(null);

  const patch = async (twitchUserId: string, fields: Partial<Pick<Moderator, 'canCurate' | 'canSetNowPlaying'>>) => {
    setBusy(twitchUserId);
    const body: Record<string, unknown> = { twitchUserId };
    if ('canCurate' in fields) body.canCurate = fields.canCurate;
    if ('canSetNowPlaying' in fields) body.canSetNowPlaying = fields.canSetNowPlaying;
    const r = await fetch('/api/curators', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    setBusy(null);
    if (r.ok) {
      setMods((ms) => ms.map((m) => (m.twitchUserId === twitchUserId ? { ...m, ...fields } : m)));
    }
  };

  const toggleCurate = (twitchUserId: string, canCurate: boolean) => {
    // Revoking curate access also revokes can_set_now_playing, which is
    // meaningless without it (a mod who can't reach the deck at all
    // shouldn't keep a dormant permission that would silently reactivate if
    // curate access is ever granted back without a fresh decision on it).
    patch(twitchUserId, canCurate ? { canCurate } : { canCurate, canSetNowPlaying: false });
  };

  return (
    <div>
      <p className="text-sm text-ink/70 leading-relaxed mb-4 max-w-prose">
        Let a mod help organize your deck — arrange segments, reorder, and add links — without
        controlling live playback. They get a curate-only view of the deck. Mods appear here once
        they&apos;ve signed in to The Broadside and are a moderator of your channel.
      </p>
      {mods.length === 0 ? (
        <p className="font-mono text-xs text-ink/50">No mods have signed in yet.</p>
      ) : (
        <div className="space-y-2">
          {mods.map((m) => (
            <div key={m.twitchUserId}>
              <label className="flex items-center gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={m.canCurate}
                  disabled={busy === m.twitchUserId}
                  onChange={(e) => toggleCurate(m.twitchUserId, e.target.checked)}
                />
                <span className="font-mono text-sm">{m.login}</span>
                {m.canCurate && (
                  <span className="font-mono text-[10px] uppercase tracking-widest text-moss">curator</span>
                )}
              </label>
              {/* Only offered once curate access is on — the deck redirects
                  a mod without can_curate before this permission could ever
                  matter, so showing it unconditionally would just invite a
                  streamer to grant a bit that does nothing. */}
              {m.canCurate && (
                <label className="flex items-center gap-3 cursor-pointer ml-7 mt-1">
                  <input
                    type="checkbox"
                    checked={m.canSetNowPlaying}
                    disabled={busy === m.twitchUserId}
                    onChange={(e) => patch(m.twitchUserId, { canSetNowPlaying: e.target.checked })}
                  />
                  <span className="text-xs text-ink/70">
                    Can also set the currently playing item — for fixing a misclick or a
                    forgotten advance
                  </span>
                </label>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

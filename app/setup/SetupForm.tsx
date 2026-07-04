'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { AppHeader } from '@/components/AppHeader';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useEventSubStatus } from '@/lib/use-eventsub-status';

export function SetupForm({
  streamId,
  displayName,
  submitCommand,
  allowAnyone,
  allowDuplicates,
  ignoredUsers,
  preferredSources,
  addToken,
  isAdmin = false,
  moderators,
}: {
  streamId: string;
  displayName: string;
  submitCommand: string;
  allowAnyone: boolean;
  allowDuplicates: boolean;
  ignoredUsers: string[];
  preferredSources: string[];
  addToken: string | null;
  isAdmin?: boolean;
  moderators: { twitchUserId: string; login: string; canCurate: boolean }[];
}) {
  const [cmd, setCmd] = useState(submitCommand);
  const [open, setOpen] = useState(allowAnyone);
  const [dupes, setDupes] = useState(allowDuplicates);
  const [ignored, setIgnored] = useState<string[]>(ignoredUsers);
  const [ignoreInput, setIgnoreInput] = useState('');
  const [sources, setSources] = useState<string[]>(preferredSources);
  const [sourceInput, setSourceInput] = useState('');
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setSaving(true);
    const r = await fetch('/api/setup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ submit_command: cmd, allow_anyone: open, allow_duplicates: dupes, ignored_users: ignored, preferred_sources: sources }),
    });
    setSaving(false);
    if (r.ok) {
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    }
  };

  const logout = async () => {
    await fetch('/api/auth', { method: 'POST' });
    window.location.href = '/';
  };

  return (
    <div className="min-h-screen flex flex-col">
      <AppHeader
        className="border-b-2 border-ink px-6 py-3 gap-6"
        section="settings"
        right={
          <>
            <Link href="/deck" className="underline hover:text-rust">Streamer Deck</Link>
            <Link href="/mod" className="underline hover:text-rust">Mod View</Link>
            {isAdmin && <Link href="/admin" className="underline hover:text-rust">Admin</Link>}
          </>
        }
      />

      <main className="px-6 py-10 max-w-2xl mx-auto w-full">
      <h1 className="font-display text-4xl font-bold mb-2">Settings</h1>
      <div className="rule-double mb-8" />

      <section className="mb-10">
        <h2 className="font-display text-2xl font-bold mb-4">Chat capture</h2>

        <label className="block mb-6">
          <span className="font-mono text-xs uppercase tracking-widest text-ink/60">
            Submit command (leave blank to capture every URL)
          </span>
          <Input
            value={cmd}
            onChange={(e) => setCmd(e.target.value)}
            placeholder="!submit"
            className="w-full mt-1 p-3"
          />
          <span className="block mt-1 text-xs text-ink/60">
            With a command, viewers must type e.g. <code>!submit https://...</code>. Without one, every URL in chat is captured.
          </span>
        </label>

        <label className="flex items-start gap-3 mb-6 cursor-pointer">
          <input
            type="checkbox"
            checked={open}
            onChange={(e) => setOpen(e.target.checked)}
            className="mt-1"
          />
          <span>
            <span className="font-mono text-xs uppercase tracking-widest">Allow anyone to submit</span>
            <span className="block text-xs text-ink/60 mt-0.5">
              If unchecked, only subscribers, VIPs, and moderators can add links.
            </span>
          </span>
        </label>

        <label className="flex items-start gap-3 mb-6 cursor-pointer">
          <input
            type="checkbox"
            checked={dupes}
            onChange={(e) => setDupes(e.target.checked)}
            className="mt-1"
          />
          <span>
            <span className="font-mono text-xs uppercase tracking-widest">Allow duplicate links</span>
            <span className="block text-xs text-ink/60 mt-0.5">
              If checked, the same URL can be submitted more than once. Useful if you want to revisit links across streams.
            </span>
          </span>
        </label>

        <div className="mb-6">
          <span className="font-mono text-xs uppercase tracking-widest text-ink/60 block mb-2">
            Ignored usernames
          </span>
          <span className="block text-xs text-ink/60 mb-2">
            Links from these users (e.g. bots) will be silently dropped.
          </span>
          <div className="flex gap-1 mb-2">
            <Input
              value={ignoreInput}
              onChange={(e) => setIgnoreInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  const name = ignoreInput.trim().toLowerCase();
                  if (name && !ignored.includes(name)) setIgnored([...ignored, name]);
                  setIgnoreInput('');
                }
              }}
              placeholder="nightbot"
              className="flex-1 p-2"
            />
            <Button
              type="button"
              size="sm"
              className="py-2"
              onClick={() => {
                const name = ignoreInput.trim().toLowerCase();
                if (name && !ignored.includes(name)) setIgnored([...ignored, name]);
                setIgnoreInput('');
              }}
            >
              Add
            </Button>
          </div>
          {ignored.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {ignored.map((u) => (
                <span
                  key={u}
                  className="inline-flex items-center gap-1 font-mono text-xs bg-ink/10 border border-ink/20 px-2 py-1"
                >
                  {u}
                  <button
                    type="button"
                    onClick={() => setIgnored(ignored.filter((x) => x !== u))}
                    className="text-ink/40 hover:text-rust"
                    aria-label={`Remove ${u}`}
                  >
                    &times;
                  </button>
                </span>
              ))}
            </div>
          )}
        </div>

        <div className="rule-double my-8" />

        <h2 className="font-display text-2xl font-bold mb-4">Related coverage</h2>

        <div className="mb-6">
          <span className="font-mono text-xs uppercase tracking-widest text-ink/60 block mb-2">
            Preferred sources
          </span>
          <span className="block text-xs text-ink/60 mb-2">
            Domains to prioritise when searching for related articles (e.g. reuters.com, apnews.com). Results from these sites will appear first in the streamer deck.
          </span>
          <div className="flex gap-1 mb-2">
            <Input
              value={sourceInput}
              onChange={(e) => setSourceInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  const domain = sourceInput.trim().toLowerCase().replace(/^(https?:\/\/)?(www\.)?/, '');
                  if (domain && !sources.includes(domain)) setSources([...sources, domain]);
                  setSourceInput('');
                }
              }}
              placeholder="reuters.com"
              className="flex-1 p-2"
            />
            <Button
              type="button"
              size="sm"
              className="py-2"
              onClick={() => {
                const domain = sourceInput.trim().toLowerCase().replace(/^(https?:\/\/)?(www\.)?/, '');
                if (domain && !sources.includes(domain)) setSources([...sources, domain]);
                setSourceInput('');
              }}
            >
              Add
            </Button>
          </div>
          {sources.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {sources.map((s) => (
                <span
                  key={s}
                  className="inline-flex items-center gap-1 font-mono text-xs bg-ink/10 border border-ink/20 px-2 py-1"
                >
                  {s}
                  <button
                    type="button"
                    onClick={() => setSources(sources.filter((x) => x !== s))}
                    className="text-ink/40 hover:text-rust"
                    aria-label={`Remove ${s}`}
                  >
                    &times;
                  </button>
                </span>
              ))}
            </div>
          )}
        </div>

        <Button onClick={save} disabled={saving} className="px-6 py-3">
          {saving ? 'Saving...' : 'Save'}
        </Button>
        {saved && <span className="ml-3 font-mono text-xs text-moss">Saved</span>}
      </section>

      <section className="mb-10">
        <h2 className="font-display text-2xl font-bold mb-4">Quick add</h2>
        <QuickAdd initialToken={addToken} />
      </section>

      <section className="mb-10">
        <h2 className="font-display text-2xl font-bold mb-4">Deck curators</h2>
        <Curators initial={moderators} />
      </section>

      <section className="mb-10">
        <h2 className="font-display text-2xl font-bold mb-4">Chat connection</h2>
        <EventSubStatus />
      </section>

      <section className="mb-10">
        <h2 className="font-display text-2xl font-bold mb-4">Account</h2>
        <div className="font-mono text-sm mb-4">
          Signed in as <strong>{displayName}</strong>
        </div>
        <div className="font-mono text-xs text-ink/60 mb-4">
          Stream ID: <code>{streamId}</code>
        </div>
        <Button variant="outline" onClick={logout}>
          Sign out
        </Button>
      </section>

      <section>
        <h2 className="font-display text-2xl font-bold mb-4">Show notes</h2>
        <div className="space-y-2 font-mono text-sm">
          <div><a href="/api/notes?format=markdown&commit=1" className="underline hover:text-rust">-&gt; Export show notes since last export (Markdown)</a></div>
          <div><a href="/api/notes?format=markdown" className="underline hover:text-rust text-ink/60">-&gt; Preview latest notes (don&apos;t mark exported)</a></div>
        </div>
      </section>
      </main>
    </div>
  );
}

// -- Deck curators --

function Curators({ initial }: { initial: { twitchUserId: string; login: string; canCurate: boolean }[] }) {
  const [mods, setMods] = useState(initial);
  const [busy, setBusy] = useState<string | null>(null);

  const toggle = async (twitchUserId: string, canCurate: boolean) => {
    setBusy(twitchUserId);
    const r = await fetch('/api/curators', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ twitchUserId, canCurate }),
    });
    setBusy(null);
    if (r.ok) {
      setMods((ms) => ms.map((m) => (m.twitchUserId === twitchUserId ? { ...m, canCurate } : m)));
    }
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
        <div className="space-y-1">
          {mods.map((m) => (
            <label key={m.twitchUserId} className="flex items-center gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={m.canCurate}
                disabled={busy === m.twitchUserId}
                onChange={(e) => toggle(m.twitchUserId, e.target.checked)}
              />
              <span className="font-mono text-sm">{m.login}</span>
              {m.canCurate && (
                <span className="font-mono text-[10px] uppercase tracking-widest text-moss">curator</span>
              )}
            </label>
          ))}
        </div>
      )}
    </div>
  );
}

// -- Quick add (bookmarklet) widget --

function QuickAdd({ initialToken }: { initialToken: string | null }) {
  const [token, setToken] = useState<string | null>(initialToken);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [tokenCopied, setTokenCopied] = useState(false);
  const [overlayCopied, setOverlayCopied] = useState(false);
  const linkRef = useRef<HTMLAnchorElement>(null);

  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  const bookmarklet = token
    ? `javascript:(function(){window.open('${origin}/quick-add?token=${token}&url='+encodeURIComponent(location.href),'nr_add','width=440,height=280');})();`
    : '';
  const overlayUrl = token ? `${origin}/overlay?token=${token}` : '';

  // React blocks javascript: hrefs, so set it on the DOM node directly.
  useEffect(() => {
    if (linkRef.current && bookmarklet) linkRef.current.setAttribute('href', bookmarklet);
  }, [bookmarklet]);

  const { confirm, confirmDialog } = useConfirm();

  const generate = async () => {
    if (token && !(await confirm({
      title: 'Regenerate add token?',
      description: 'Your existing bookmarklet, extension, and OBS overlay URL will stop working until you replace the token.',
      confirmText: 'Regenerate',
      destructive: true,
    }))) return;
    setBusy(true);
    try {
      const r = await fetch('/api/deck/token', { method: 'POST' });
      if (r.ok) {
        const d = await r.json();
        setToken(d.token);
      }
    } finally {
      setBusy(false);
    }
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(bookmarklet);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard unavailable */
    }
  };

  const copyOverlay = async () => {
    if (!overlayUrl) return;
    try {
      await navigator.clipboard.writeText(overlayUrl);
      setOverlayCopied(true);
      setTimeout(() => setOverlayCopied(false), 1500);
    } catch {
      /* clipboard unavailable */
    }
  };

  const copyToken = async () => {
    if (!token) return;
    try {
      await navigator.clipboard.writeText(token);
      setTokenCopied(true);
      setTimeout(() => setTokenCopied(false), 1500);
    } catch {
      /* clipboard unavailable */
    }
  };

  return (
    <div>
      {confirmDialog}
      <p className="text-sm text-ink/70 leading-relaxed mb-4 max-w-prose">
        Add the page you&apos;re on straight to your deck while prepping — no copy/paste or
        tab-switching. Works on articles, tweets, and YouTube videos (paste a playlist URL to
        bulk-add). Items land as <strong>approved</strong>, ready in the deck.
      </p>

      {!token ? (
        <Button onClick={generate} disabled={busy}>
          {busy ? 'Generating…' : 'Generate add link'}
        </Button>
      ) : (
        <div className="space-y-4">
          <div>
            <p className="font-mono text-xs uppercase tracking-widest text-ink/60 mb-2">
              Drag this to your bookmarks bar:
            </p>
            {/* eslint-disable-next-line jsx-a11y/anchor-is-valid */}
            <a
              ref={linkRef}
              onClick={(e) => e.preventDefault()}
              draggable
              className="inline-block cursor-grab active:cursor-grabbing font-mono text-sm uppercase tracking-widest bg-moss text-paper px-4 py-2 select-none"
              title="Drag me to your bookmarks bar"
            >
              + Add to The Broadside
            </a>
            <p className="text-xs text-ink/50 mt-2">
              Then on any page, click the bookmark — a small window confirms and closes.
              Can&apos;t drag it? <button onClick={copy} className="underline hover:text-rust">{copied ? 'Copied!' : 'Copy the code'}</button> and create a new bookmark with it as the URL.
            </p>
          </div>

          <div>
            <p className="font-mono text-xs uppercase tracking-widest text-ink/60 mb-2">
              Token (for the browser extension)
            </p>
            <div className="flex gap-1 items-center">
              <Input
                readOnly
                value={token ?? ''}
                onFocus={(e) => e.currentTarget.select()}
                className="flex-1 min-w-0 text-xs bg-ink/10 border-ink/20"
                aria-label="Add token"
              />
              <Button type="button" size="sm" className="shrink-0" onClick={copyToken}>
                {tokenCopied ? 'Copied!' : 'Copy'}
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="shrink-0"
                onClick={generate}
                disabled={busy}
              >
                {busy ? '…' : 'Regenerate'}
              </Button>
            </div>
          </div>

          <div>
            <p className="font-mono text-xs uppercase tracking-widest text-ink/60 mb-2">
              OBS overlay (browser source)
            </p>
            <div className="flex gap-1 items-center">
              <Input
                readOnly
                value={overlayUrl}
                onFocus={(e) => e.currentTarget.select()}
                className="flex-1 min-w-0 text-xs bg-ink/10 border-ink/20"
                aria-label="Overlay URL"
              />
              <Button type="button" size="sm" className="shrink-0" onClick={copyOverlay}>
                {overlayCopied ? 'Copied!' : 'Copy'}
              </Button>
            </div>
            <p className="text-xs text-ink/50 mt-2">
              Add this as a <strong>Browser Source</strong> in OBS (about 800×100). It shows the
              story you&apos;re reacting to as an on-air lower third — headline, outlet, and type —
              and disappears between items.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

// -- EventSub status widget --

function EventSubStatus() {
  const { status, detail, reconnecting, reconnect } = useEventSubStatus();

  const dot =
    status === 'connected' ? 'bg-moss' :
    status === 'loading' ? 'bg-ochre animate-pulse' :
    'bg-rust';

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-3 flex-wrap">
        <span className={['inline-block w-2.5 h-2.5 rounded-full', dot].join(' ')} />
        <span className="font-mono text-sm">
          {status === 'loading' && 'Checking...'}
          {status === 'connected' && 'Twitch chat connected via EventSub'}
          {status === 'disconnected' && 'Not connected -- chat links will not be captured'}
          {status === 'error' && 'Unable to connect'}
        </span>
        {(status === 'disconnected' || status === 'error') && (
          <Button variant="outline" size="sm" onClick={reconnect} disabled={reconnecting}>
            {reconnecting ? 'Connecting...' : 'Reconnect'}
          </Button>
        )}
      </div>
      {detail && (status === 'error' || status === 'disconnected') && (
        <div className="font-mono text-xs text-rust/80 break-all">{detail}</div>
      )}
    </div>
  );
}

'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { AppHeader } from '@/components/AppHeader';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { useEventSubStatus } from '@/lib/use-eventsub-status';
import { AppThemeSettings, OverlayThemeSettings } from './ThemeSettings';
import type { AppTheme, OverlayTheme } from '@/lib/theme';

// Settings outgrew a single scroll — six short panels beat one long page you
// can lose your place in. Everything about a given surface lives in one place:
// in particular the overlay's URL, layout and colours are one tab, having
// previously been split between "Quick add" and "Theme" for no better reason
// than the order they were built in.
// 'questions' is always in the type/parsing set (so an old bookmarked
// #questions hash degrades gracefully rather than crashing) but is filtered
// out of the rendered ToggleGroup below unless the account has it
// admin-enabled. It's a super-admin-gated feature, not a streamer setting:
// see schema.sql on streams.questions_enabled for why.
const TABS = [
  ['chat', 'Chat'],
  ['deck', 'Deck'],
  ['appearance', 'Appearance'],
  ['overlay', 'Overlay'],
  ['quickadd', 'Quick add'],
  ['questions', 'Questions'],
  ['account', 'Account'],
] as const;
type TabId = (typeof TABS)[number][0];

function isTabId(v: string): v is TabId {
  return (TABS as readonly (readonly [string, string])[]).some(([id]) => id === v);
}

export function SetupForm({
  streamId,
  displayName,
  submitCommand,
  videoCommand,
  allowAnyone,
  allowDuplicates,
  ignoredUsers,
  preferredSources,
  addToken,
  appTheme,
  overlayTheme,
  questionsEnabled = false,
  questionCommand,
  isAdmin = false,
  moderators,
}: {
  streamId: string;
  displayName: string;
  submitCommand: string;
  videoCommand: string;
  allowAnyone: boolean;
  allowDuplicates: boolean;
  ignoredUsers: string[];
  preferredSources: string[];
  addToken: string | null;
  appTheme: AppTheme;
  overlayTheme: OverlayTheme;
  questionsEnabled?: boolean;
  questionCommand: string;
  isAdmin?: boolean;
  moderators: { twitchUserId: string; login: string; canCurate: boolean }[];
}) {
  const [cmd, setCmd] = useState(submitCommand);
  const [videoCmd, setVideoCmd] = useState(videoCommand);
  const [questionCmd, setQuestionCmd] = useState(questionCommand);
  const [open, setOpen] = useState(allowAnyone);
  const [dupes, setDupes] = useState(allowDuplicates);
  const [ignored, setIgnored] = useState<string[]>(ignoredUsers);
  const [ignoreInput, setIgnoreInput] = useState('');
  const [sources, setSources] = useState<string[]>(preferredSources);
  const [sourceInput, setSourceInput] = useState('');
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  // The add token is one secret behind two features (quick-add and the
  // overlay URL), so it lives here rather than inside either tab — otherwise
  // regenerating it on one tab would leave the other showing a dead URL until
  // a reload.
  const [token, setToken] = useState<string | null>(addToken);

  const [tab, setTab] = useState<TabId>('chat');
  // Deep-linkable and refresh-proof via the hash, which needs no router round
  // trip. Read in an effect rather than at init so the server and the first
  // client render agree. The hashchange listener is what makes an edited URL
  // and the back button work — without it the hash and the visible tab drift
  // apart, and a shared link only lands right on a cold load.
  useEffect(() => {
    const apply = () => {
      const fromHash = window.location.hash.replace(/^#/, '');
      // A #questions hash saved from before the account had this enabled (or
      // after an admin later disabled it) shouldn't select a tab that isn't
      // being rendered — falls back to whatever's already selected.
      if (isTabId(fromHash) && (fromHash !== 'questions' || questionsEnabled)) setTab(fromHash);
    };
    apply();
    window.addEventListener('hashchange', apply);
    return () => window.removeEventListener('hashchange', apply);
  }, [questionsEnabled]);
  // pushState, not replaceState, so each tab is a back-button step — landing
  // on Settings and pressing back should return you to the deck, but stepping
  // through five tabs and pressing back should go back one tab.
  const selectTab = (id: TabId) => {
    setTab(id);
    if (window.location.hash !== `#${id}`) history.pushState(null, '', `#${id}`);
  };

  const save = async () => {
    setSaving(true);
    setSaveError('');
    const r = await fetch('/api/setup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        submit_command: cmd,
        video_command: videoCmd,
        allow_anyone: open,
        allow_duplicates: dupes,
        ignored_users: ignored,
        preferred_sources: sources,
        // Sent unconditionally (same as the other command fields, sent from
        // every tab's Save) — the server only persists it when the account
        // has questions_enabled, so this is a no-op for accounts without it.
        question_command: questionCmd,
      }),
    });
    setSaving(false);
    if (r.ok) {
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } else {
      const data = await r.json().catch(() => ({}));
      setSaveError(data.detail || data.error || 'Could not save.');
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
            <Link href="/shelf" className="underline hover:text-rust">Shelf</Link>
            {isAdmin && <Link href="/admin" className="underline hover:text-rust">Admin</Link>}
          </>
        }
      />

      <main className="px-6 py-10 max-w-2xl mx-auto w-full">
      <h1 className="font-display text-4xl font-bold mb-3">Settings</h1>

      <ToggleGroup
        type="single"
        value={tab}
        onValueChange={(v) => { if (v && isTabId(v)) selectTab(v); }}
        className="gap-0 border-b-2 border-ink/20 mb-8"
        aria-label="Settings section"
      >
        {TABS.filter(([id]) => id !== 'questions' || questionsEnabled).map(([id, label]) => (
          <ToggleGroupItem key={id} value={id} variant="tab" className="text-xs">
            {label}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>

      {tab === 'chat' && (
      <>
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

        <label className="block mb-6">
          <span className="font-mono text-xs uppercase tracking-widest text-ink/60">
            &quot;What&apos;s playing&quot; command (leave blank to disable)
          </span>
          <Input
            value={videoCmd}
            onChange={(e) => setVideoCmd(e.target.value)}
            placeholder="!video"
            className="w-full mt-1 p-3"
          />
          <span className="block mt-1 text-xs text-ink/60">
            Any viewer who types this gets the same &quot;Watching: …&quot; message the deck&apos;s
            &quot;Post to chat&quot; button sends — handy for people who can&apos;t see pinned messages.
            Limited to once every 15 seconds per channel.
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

        <Button onClick={save} disabled={saving} className="px-6 py-3">
          {saving ? 'Saving...' : 'Save'}
        </Button>
        {saved && <span className="ml-3 font-mono text-xs text-moss">Saved</span>}
        {saveError && <span className="ml-3 font-mono text-xs text-rust">{saveError}</span>}
      </section>

      <section className="mb-10">
        <h2 className="font-display text-2xl font-bold mb-4">Chat connection</h2>
        <EventSubStatus />
      </section>
      </>
      )}

      {tab === 'deck' && (
      <>
      <section className="mb-10">
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
        {saveError && <span className="ml-3 font-mono text-xs text-rust">{saveError}</span>}
      </section>

      <section className="mb-10">
        <h2 className="font-display text-2xl font-bold mb-4">Deck curators</h2>
        <Curators initial={moderators} />
      </section>
      </>
      )}

      {tab === 'appearance' && <AppThemeSettings initial={appTheme} />}

      {tab === 'overlay' && (
      <>
        <OverlaySource token={token} />
        <div className="rule-double my-8" />
        <OverlayThemeSettings initial={overlayTheme} />
      </>
      )}

      {tab === 'quickadd' && (
      <section className="mb-10">
        <h2 className="font-display text-2xl font-bold mb-4">Quick add</h2>
        <QuickAdd token={token} setToken={setToken} />
      </section>
      )}

      {tab === 'questions' && questionsEnabled && (
      <section className="mb-10">
        <h2 className="font-display text-2xl font-bold mb-1">Questions</h2>
        <p className="text-sm text-ink/70 mb-6 max-w-prose leading-relaxed">
          Let viewers submit questions for an interview or Q&amp;A segment. A mod clears each one
          before it&apos;s visible to you — see <Link href="/questions" className="underline hover:text-rust">the Questions page</Link> —
          and approved questions also show up in a panel on the deck while you&apos;re live.
        </p>

        <label className="block mb-6">
          <span className="font-mono text-xs uppercase tracking-widest text-ink/60">
            Question command (leave blank to disable)
          </span>
          <Input
            value={questionCmd}
            onChange={(e) => setQuestionCmd(e.target.value)}
            placeholder="!question"
            className="w-full mt-1 p-3"
          />
          <span className="block mt-1 text-xs text-ink/60">
            Viewers type e.g. <code>!question what made you run?</code>. Gated the same as link
            submission — if &quot;Allow anyone to submit&quot; on the Chat tab is off, only subs,
            VIPs, and mods can ask. Limited to one question every 20 seconds per viewer.
          </span>
        </label>

        <Button onClick={save} disabled={saving} className="px-6 py-3">
          {saving ? 'Saving...' : 'Save'}
        </Button>
        {saved && <span className="ml-3 font-mono text-xs text-moss">Saved</span>}
        {saveError && <span className="ml-3 font-mono text-xs text-rust">{saveError}</span>}
      </section>
      )}

      {tab === 'account' && (
      <>
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
      </>
      )}
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

function QuickAdd({
  token,
  setToken,
}: {
  token: string | null;
  setToken: (t: string | null) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [tokenCopied, setTokenCopied] = useState(false);
  const linkRef = useRef<HTMLAnchorElement>(null);

  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  const bookmarklet = token
    ? `javascript:(function(){window.open('${origin}/quick-add?token=${token}&url='+encodeURIComponent(location.href),'nr_add','width=440,height=280');})();`
    : '';

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
            <p className="text-xs text-ink/50 mt-2">
              Get the extension from the{' '}
              <a
                href="https://chromewebstore.google.com/search/The%20Broadside%20Quick%20Add"
                target="_blank"
                rel="noreferrer"
                className="underline hover:text-rust"
              >
                Chrome Web Store
              </a>{' '}
              (&ldquo;The Broadside Quick Add&rdquo;), then paste this token into its Options page.
            </p>
          </div>

        </div>
      )}
    </div>
  );
}

// -- OBS browser source (the overlay's URL, layout and mark) --

/**
 * Lives on the Overlay tab next to the colours, rather than under Quick add
 * where it started. It only ended up there because it happens to be built from
 * the same add token, which is an implementation detail — a streamer setting up
 * their on-air graphic shouldn't have to know it to find this.
 */
function OverlaySource({ token }: { token: string | null }) {
  const [copied, setCopied] = useState(false);
  const [brand, setBrand] = useState(true);
  const [variant, setVariant] = useState('default');

  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  const url = token
    // No &theme=: colours live on the stream row so they can change without
    // re-pasting this into OBS. Only the two things a source genuinely can't
    // be told later — layout and the mark — stay in the URL.
    ? `${origin}/overlay?token=${token}${brand ? '' : '&brand=0'}${variant === 'default' ? '' : `&variant=${variant}`}`
    : '';

  const copy = async () => {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard unavailable */
    }
  };

  return (
    <section>
      <h2 className="font-display text-2xl font-bold mb-1">Overlay</h2>
      <p className="text-sm text-ink/70 mb-6 max-w-prose leading-relaxed">
        The on-air lower third: what&apos;s playing, and any trigger warning on it. Add it to OBS
        once — after that, everything below updates a live source on its own.
      </p>

      {!token ? (
        <p className="font-mono text-xs text-ink/60">
          Generate an add token under <strong>Quick add</strong> first — the overlay URL is built
          from it.
        </p>
      ) : (
        <>
          <h3 className="font-display text-xl font-bold mb-2">Browser source</h3>
          <ToggleGroup
            type="single"
            value={variant}
            onValueChange={(v) => { if (v) setVariant(v); }}
            className="mb-2 text-[10px]"
            aria-label="Overlay layout"
          >
            {([
              ['default', 'Full'],
              ['minimal', 'Minimal'],
              ['ticker', 'Up next'],
            ] as const).map(([value, label]) => (
              <ToggleGroupItem key={value} value={value}>
                {label}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
          <label className="flex items-center gap-2 mb-2 cursor-pointer">
            <input type="checkbox" checked={brand} onChange={(e) => setBrand(e.target.checked)} />
            <span className="font-mono text-xs">Show &ldquo;The Broadside&rdquo; mark on the card</span>
          </label>
          <div className="flex gap-1 items-center">
            <Input
              readOnly
              value={url}
              onFocus={(e) => e.currentTarget.select()}
              className="flex-1 min-w-0 text-xs bg-ink/10 border-ink/20"
              aria-label="Overlay URL"
            />
            <Button type="button" size="sm" className="shrink-0" onClick={copy}>
              {copied ? 'Copied!' : 'Copy'}
            </Button>
          </div>
          <p className="text-xs text-ink/50 mt-2">
            Add as a <strong>Browser Source</strong> in OBS, about 800×100 (800×120 for Up next).
            <strong> Full</strong> shows a lower third — headline, outlet, and type.
            <strong> Minimal</strong> is a single-line title-only chip. <strong>Up next</strong>
            {' '}adds a strip showing what&apos;s queued after it. All disappear between items.
            Layout and the mark are baked into this URL, since an OBS source has no UI to change
            them later — so changing either means re-copying it. Colours and type don&apos;t: those
            reach a live source on their own.
          </p>
        </>
      )}
    </section>
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

'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { AppHeader } from '@/components/AppHeader';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { AppThemeSettings, OverlayThemeSettings } from './ThemeSettings';
import type { AppTheme, OverlayTheme } from '@/lib/theme';
import { Curators } from './Curators';
import { QuickAdd } from './QuickAdd';
import { OverlaySource } from './OverlaySource';
import { EventSubStatus } from './EventSubStatus';

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
  questionsOpen = true,
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
  questionsOpen?: boolean;
  isAdmin?: boolean;
  moderators: { twitchUserId: string; login: string; canCurate: boolean; canSetNowPlaying: boolean }[];
}) {
  const [cmd, setCmd] = useState(submitCommand);
  const [videoCmd, setVideoCmd] = useState(videoCommand);
  const [questionCmd, setQuestionCmd] = useState(questionCommand);
  const [questionsAreOpen, setQuestionsAreOpen] = useState(questionsOpen);
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
        // every tab's Save) — the server only persists these when the
        // account has questions_enabled, so this is a no-op for accounts
        // without it.
        question_command: questionCmd,
        questions_open: questionsAreOpen,
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

        <label className="flex items-start gap-3 mb-6 cursor-pointer">
          <input
            type="checkbox"
            checked={questionsAreOpen}
            onChange={(e) => setQuestionsAreOpen(e.target.checked)}
            className="mt-1"
          />
          <span>
            <span className="font-mono text-xs uppercase tracking-widest">
              Currently open to new questions
            </span>
            <span className="block text-xs text-ink/60 mt-0.5">
              Turn this off any time to pause new submissions — chat&apos;s command goes quiet
              immediately. Nothing already collected is affected, and mods can still triage what&apos;s
              there. Unlike clearing the command below, turning this back on doesn&apos;t require
              retyping it.
            </span>
          </span>
        </label>

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


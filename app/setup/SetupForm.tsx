'use client';

import Link from 'next/link';
import { useState } from 'react';

export function SetupForm({
  streamId,
  displayName,
  submitCommand,
  allowAnyone,
  allowDuplicates,
  ignoredUsers,
}: {
  streamId: string;
  displayName: string;
  submitCommand: string;
  allowAnyone: boolean;
  allowDuplicates: boolean;
  ignoredUsers: string[];
}) {
  const [cmd, setCmd] = useState(submitCommand);
  const [open, setOpen] = useState(allowAnyone);
  const [dupes, setDupes] = useState(allowDuplicates);
  const [ignored, setIgnored] = useState<string[]>(ignoredUsers);
  const [ignoreInput, setIgnoreInput] = useState('');
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setSaving(true);
    const r = await fetch('/api/setup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ submit_command: cmd, allow_anyone: open, allow_duplicates: dupes, ignored_users: ignored }),
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
    <div className="min-h-screen px-6 py-10 max-w-2xl mx-auto">
      <header className="mb-8">
        <Link href="/" className="font-display text-2xl font-black">Newsroom</Link>
        <span className="font-mono text-xs uppercase tracking-widest text-ink/60 ml-3">/ settings</span>
      </header>

      <h1 className="font-display text-4xl font-bold mb-2">Settings</h1>
      <div className="rule-double mb-8" />

      <section className="mb-10">
        <h2 className="font-display text-2xl font-bold mb-4">Chat capture</h2>

        <label className="block mb-6">
          <span className="font-mono text-xs uppercase tracking-widest text-ink/60">
            Submit command (leave blank to capture every URL)
          </span>
          <input
            value={cmd}
            onChange={(e) => setCmd(e.target.value)}
            placeholder="!submit"
            className="w-full mt-1 border border-ink/30 bg-paper p-3 font-mono text-sm focus:outline-none focus:border-ink"
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
            <input
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
              className="flex-1 border border-ink/30 bg-paper p-2 font-mono text-sm focus:outline-none focus:border-ink"
            />
            <button
              type="button"
              onClick={() => {
                const name = ignoreInput.trim().toLowerCase();
                if (name && !ignored.includes(name)) setIgnored([...ignored, name]);
                setIgnoreInput('');
              }}
              className="font-mono text-xs uppercase tracking-widest bg-ink text-paper px-3 py-2 hover:bg-rust"
            >
              Add
            </button>
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

        <button
          onClick={save}
          disabled={saving}
          className="font-mono text-sm uppercase tracking-widest bg-ink text-paper px-6 py-3 hover:bg-rust disabled:opacity-50"
        >
          {saving ? 'Saving…' : 'Save'}
        </button>
        {saved && <span className="ml-3 font-mono text-xs text-moss">✓ saved</span>}
      </section>

      <section className="mb-10">
        <h2 className="font-display text-2xl font-bold mb-4">Account</h2>
        <div className="font-mono text-sm mb-4">
          Signed in as <strong>{displayName}</strong>
        </div>
        <div className="font-mono text-xs text-ink/60 mb-4">
          Stream ID: <code>{streamId}</code>
        </div>
        <button
          onClick={logout}
          className="font-mono text-sm uppercase tracking-widest border border-ink/40 px-4 py-2 hover:bg-ink hover:text-paper"
        >
          Sign out
        </button>
      </section>

      <section>
        <h2 className="font-display text-2xl font-bold mb-4">Quick links</h2>
        <div className="space-y-2 font-mono text-sm">
          <div><Link href="/deck" className="underline hover:text-rust">→ Streamer Deck</Link></div>
          <div><Link href="/mod" className="underline hover:text-rust">→ Mod Triage</Link></div>
          <div><a href="/api/notes?format=markdown" className="underline hover:text-rust">→ Export show notes (Markdown)</a></div>
        </div>
      </section>
    </div>
  );
}

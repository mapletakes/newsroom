'use client';

import { Wordmark } from '@/components/ui/wordmark';

type StreamOption = { id: string; login: string; name: string };

export function ChooseView({
  displayName,
  ownStream,
  modStreams,
}: {
  displayName: string;
  ownStream: StreamOption | null;
  modStreams: StreamOption[];
}) {
  const switchTo = async (streamId: string, role: 'streamer' | 'mod', dest: string) => {
    await fetch('/api/auth/switch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ streamId, role }),
    });
    window.location.href = dest;
  };

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

      {modStreams.length > 0 && (
        <section>
          <h2 className="font-display text-2xl font-bold mb-4">Channels you moderate</h2>
          <div className="space-y-3">
            {modStreams.map((s) => (
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
        </section>
      )}
    </div>
  );
}

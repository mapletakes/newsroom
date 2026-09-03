'use client';

// "Post to chat" button for the mod view's "on air" bar — posts the
// currently-playing item's "Watching: …" message, with an opt-in pin.
// Fully self-contained. Split out of ModView.tsx as a structural move only,
// no rendered output changed.

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';

export function AnnounceButton({ submissionId }: { submissionId: string }) {
  const [status, setStatus] = useState('');
  // Opt-in per click, not sticky — see DeckView's pinOnAnnounce for why.
  const [pin, setPin] = useState(false);
  const post = async () => {
    if (status === 'Posting…') return;
    setStatus('Posting…');
    try {
      const r = await fetch('/api/deck/announce', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: submissionId, pin }),
      });
      if (r.ok) {
        setStatus(pin ? 'Posted & pinned ✓' : 'Posted ✓');
      } else {
        const e = await r.json().catch(() => ({}));
        setStatus(e.detail || e.error || 'Failed');
      }
    } catch {
      setStatus('Failed');
    }
    setTimeout(() => setStatus(''), 4000);
  };
  return (
    <span className="shrink-0 flex items-center gap-2">
      <Button
        variant="outline"
        size="xs"
        onClick={post}
        className="text-xs"
        title={pin ? "Post 'Watching: …' to chat and pin it for 20 minutes" : "Post 'Watching: …' to chat"}
        aria-label="Post 'Watching: …' to chat"
      >
        <Icon name="announce" className="text-sm" />
        <span className="hidden sm:inline">Post to chat</span>
      </Button>
      <label
        className="hidden sm:flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-widest text-ink/60 cursor-pointer"
        title="Pins the message for 20 minutes and replaces whatever's currently pinned. Needs your Twitch account reconnected since this was added — if it's not, the post fails outright rather than sending unpinned."
      >
        <input type="checkbox" checked={pin} onChange={(e) => setPin(e.target.checked)} />
        Pin
      </label>
      {status && <span className="font-mono text-xs text-ink/60">{status}</span>}
    </span>
  );
}

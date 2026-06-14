'use client';

import { useEffect, useState } from 'react';

// Shows a link to the archive.today snapshot if archived, otherwise a button
// that triggers archiving. Clicking "Archive" opens archive.today's capture
// flow in a new tab — a real browser/IP gets past Cloudflare where our server
// can't — and persists the snapshot link to the card.
export function ArchiveButton({
  id,
  url,
  archiveUrl,
  className = '',
}: {
  id: string;
  url: string;
  archiveUrl: string | null;
  className?: string;
}) {
  const [stored, setStored] = useState<string | null>(archiveUrl);
  const [busy, setBusy] = useState(false);

  // Pick up archive_url that arrives via a later refresh/broadcast.
  useEffect(() => {
    if (archiveUrl) setStored(archiveUrl);
  }, [archiveUrl]);

  if (stored) {
    return (
      <a
        href={stored}
        target="_blank"
        rel="noreferrer"
        className={`font-mono text-xs uppercase tracking-widest text-moss hover:underline inline-flex items-center gap-1 ${className}`}
        title="View the archived snapshot (archive.today)"
      >
        <span className="material-icons text-sm">photo_camera</span>
        Archived ↗
      </a>
    );
  }

  const archive = () => {
    if (busy) return;
    // Open the archiver first, synchronously, so it counts as a user gesture
    // (an async window.open after fetch would be popup-blocked).
    if (url) {
      window.open(`https://archive.today/?run=1&url=${encodeURIComponent(url)}`, '_blank', 'noopener');
    }
    setBusy(true);
    fetch('/api/archive', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id }),
    })
      .then((r) => r.json())
      .then((data) => {
        if (data?.archive_url) setStored(data.archive_url);
      })
      .catch(() => {})
      .finally(() => setBusy(false));
  };

  return (
    <button
      onClick={archive}
      disabled={busy}
      className={`font-mono text-xs uppercase tracking-widest text-ink/50 hover:text-ink inline-flex items-center gap-1 disabled:opacity-60 ${className}`}
      title="Save a snapshot to archive.today"
    >
      <span className="material-icons text-sm">photo_camera</span>
      {busy ? 'Archiving…' : 'Archive'}
    </button>
  );
}

'use client';

import { useEffect, useState } from 'react';
import { Icon } from '@/components/ui/icon';

// Shows a link to the snapshot if archived, otherwise a button that triggers
// archiving. The server freezes the page itself (lib/archive.ts) and returns
// our own /a/<id> link, falling back to an archive.today link if it can't.
export function ArchiveButton({
  id,
  archiveUrl,
  className = '',
}: {
  id: string;
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
        title="View the archived snapshot"
      >
        <Icon name="camera" className="text-sm" />
        Archived ↗
      </a>
    );
  }

  const archive = () => {
    if (busy) return;
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
      title="Save a snapshot of this page"
    >
      <Icon name="camera" className="text-sm" />
      {busy ? 'Archiving…' : 'Archive'}
    </button>
  );
}

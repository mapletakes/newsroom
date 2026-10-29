'use client';

import { useState } from 'react';
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
  // The deck keeps this mounted while the active item changes, so a link we
  // got back from archiving — and the busy flag — are remembered against the
  // item they belong to. Otherwise switching to an unarchived item would keep
  // showing the previous item's link, and a capture still in flight would
  // land on whichever item is showing when it finishes.
  const [result, setResult] = useState<{ id: string; url: string } | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const stored = archiveUrl || (result?.id === id ? result.url : null);
  const busy = busyId === id;

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
    const forId = id;
    setBusyId(forId);
    fetch('/api/archive', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: forId }),
    })
      .then((r) => r.json())
      .then((data) => {
        if (data?.archive_url) setResult({ id: forId, url: data.archive_url });
      })
      .catch(() => {})
      .finally(() => setBusyId((cur) => (cur === forId ? null : cur)));
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

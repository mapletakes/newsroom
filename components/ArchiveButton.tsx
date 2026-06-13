'use client';

import { useEffect, useState } from 'react';

// Shows a link to the Wayback snapshot if archived, otherwise a button that
// triggers archiving. Client-driven so the request survives the serverless
// function lifecycle and doesn't block other actions.
export function ArchiveButton({
  id,
  archiveUrl,
  className = '',
}: {
  id: string;
  archiveUrl: string | null;
  className?: string;
}) {
  const [url, setUrl] = useState<string | null>(archiveUrl);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  // Pick up archive_url that arrives via a later refresh/broadcast.
  useEffect(() => {
    if (archiveUrl) setUrl(archiveUrl);
  }, [archiveUrl]);

  if (url) {
    return (
      <a
        href={url}
        target="_blank"
        rel="noreferrer"
        className={`font-mono text-xs uppercase tracking-widest text-moss hover:underline inline-flex items-center gap-1 ${className}`}
        title="View the archived snapshot"
      >
        <span className="material-icons text-sm">photo_camera</span>
        Archived ↗
      </a>
    );
  }

  const archive = async () => {
    if (busy) return;
    setBusy(true);
    setFailed(false);
    try {
      const r = await fetch('/api/archive', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      });
      const data = await r.json().catch(() => ({}));
      if (r.ok && data.archive_url) setUrl(data.archive_url);
      else setFailed(true);
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  };

  return (
    <button
      onClick={archive}
      disabled={busy}
      className={`font-mono text-xs uppercase tracking-widest text-ink/50 hover:text-ink inline-flex items-center gap-1 disabled:opacity-60 ${className}`}
      title="Save a snapshot to the Wayback Machine"
    >
      <span className="material-icons text-sm">photo_camera</span>
      {busy ? 'Archiving…' : failed ? 'Retry archive' : 'Archive'}
    </button>
  );
}

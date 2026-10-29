'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { Icon } from '@/components/ui/icon';
import { useConfirm } from '@/components/ui/confirm-dialog';

// Shows a link to the snapshot if archived, otherwise a button that triggers
// archiving. The server freezes the page itself (lib/archive.ts) and returns
// our own /a/<id> link, falling back to an archive.today link if it can't.
// With allowDelete (the deck), an archived item also gets a button that
// deletes the snapshot.
export function ArchiveButton({
  id,
  archiveUrl,
  allowDelete = false,
  className = '',
}: {
  id: string;
  archiveUrl: string | null;
  allowDelete?: boolean;
  className?: string;
}) {
  // The deck keeps this mounted while the active item changes, so a link we
  // got back from archiving — and the busy flag — are remembered against the
  // item they belong to. Otherwise switching to an unarchived item would keep
  // showing the previous item's link, and a capture still in flight would
  // land on whichever item is showing when it finishes.
  const [result, setResult] = useState<{ id: string; url: string } | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  // A deleted link stays hidden until the refetch clears archive_url.
  const [deleted, setDeleted] = useState<{ id: string; url: string } | null>(null);
  const { confirm, confirmDialog } = useConfirm();
  const live = (u: string | null) => (u && !(deleted?.id === id && deleted.url === u) ? u : null);
  const stored = live(archiveUrl) || live(result?.id === id ? result.url : null);
  const busy = busyId === id;

  const remove = async () => {
    if (!stored || busy) return;
    const ok = await confirm({
      title: 'Delete this snapshot?',
      description: 'The archived copy is removed and its link stops working for everyone, including in show notes.',
      confirmText: 'Delete',
      destructive: true,
    });
    if (!ok) return;
    const forId = id;
    setBusyId(forId);
    try {
      const r = await fetch('/api/archive', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: forId }),
      });
      if (!r.ok) throw new Error();
      setDeleted({ id: forId, url: stored });
    } catch {
      toast.error('Could not delete the snapshot');
    } finally {
      setBusyId((cur) => (cur === forId ? null : cur));
    }
  };

  if (stored) {
    return (
      <span className={`inline-flex items-center gap-2 ${className}`}>
        <a
          href={stored}
          target="_blank"
          rel="noreferrer"
          className="font-mono text-xs uppercase tracking-widest text-moss hover:underline inline-flex items-center gap-1"
          title="View the archived snapshot"
        >
          <Icon name="camera" className="text-sm" />
          Archived ↗
        </a>
        {allowDelete && (
          <button
            onClick={remove}
            disabled={busy}
            aria-label="Delete snapshot"
            title="Delete snapshot"
            className="font-mono text-xs text-ink/40 hover:text-rust disabled:opacity-60"
          >
            {busy ? '…' : <Icon name="remove" />}
          </button>
        )}
        {confirmDialog}
      </span>
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

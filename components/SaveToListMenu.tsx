'use client';

import { useEffect, useState } from 'react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { toast } from 'sonner';

type ListSummary = { id: string; name: string };

export type SaveResult = { ok: boolean; added?: number; skipped?: number; error?: string };

// A "Save to…" trigger for copying one or more items (a submission on the
// deck/mod queue) into a durable clip file. Lists are fetched lazily on
// open rather than kept in app-wide state — this menu pops up rarely enough
// that a fresh fetch each time is simpler than cache invalidation, and it
// means a clip file created moments ago in another tab always shows up.
export function SaveToListMenu({ trigger, onSave }: {
  trigger: React.ReactElement;
  onSave: (listId: string) => Promise<SaveResult>;
}) {
  const [open, setOpen] = useState(false);
  const [lists, setLists] = useState<ListSummary[] | null>(null);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');

  useEffect(() => {
    if (!open) return;
    fetch('/api/lists')
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (d) setLists(d.lists || []); });
  }, [open]);

  const finishSave = async (listId: string, label: string) => {
    setOpen(false);
    setCreating(false);
    setNewName('');
    const res = await onSave(listId);
    if (!res.ok) toast.error(res.error || 'Failed to save');
    else if (res.added === 0 && (res.skipped ?? 0) > 0) toast(`Already on “${label}”`);
    else toast.success(`Saved to “${label}”`);
  };

  const createAndSave = async () => {
    const name = newName.trim();
    if (!name) return;
    const r = await fetch('/api/lists', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    });
    if (!r.ok) { toast.error('Failed to create clip file'); return; }
    const data = await r.json();
    await finishSave(data.list.id, data.list.name);
  };

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>{trigger}</DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        <DropdownMenuLabel>Save to clip file</DropdownMenuLabel>
        {lists === null ? (
          <div className="px-2 py-1.5 font-mono text-xs text-ink/40">Loading…</div>
        ) : lists.length === 0 ? (
          <div className="px-2 py-1.5 font-mono text-xs text-ink/40">No clip files yet</div>
        ) : (
          lists.map((l) => (
            <DropdownMenuItem key={l.id} onSelect={() => finishSave(l.id, l.name)}>
              {l.name}
            </DropdownMenuItem>
          ))
        )}
        <DropdownMenuSeparator />
        {creating ? (
          <div className="px-2 py-1.5" onClick={(e) => e.stopPropagation()}>
            <input
              autoFocus
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') { e.preventDefault(); createAndSave(); }
                if (e.key === 'Escape') { e.preventDefault(); setCreating(false); }
              }}
              placeholder="New clip file name"
              className="w-full font-mono text-xs bg-paper border border-ink/20 px-1.5 py-1 focus:outline-none focus:border-ink"
            />
          </div>
        ) : (
          <DropdownMenuItem onSelect={(e) => { e.preventDefault(); setCreating(true); }}>
            + New clip file…
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

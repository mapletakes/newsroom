'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { AppHeader } from '@/components/AppHeader';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Icon } from '@/components/ui/icon';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { relativeTime } from '@/lib/url';
import { toast } from 'sonner';
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

type ShelfSummary = {
  id: string;
  name: string;
  position: number;
  share_token: string | null;
  created_at: string;
  updated_at: string;
  item_count: number;
};

function SortableShelfRow({
  shelf,
  canCurate,
  onDelete,
}: {
  shelf: ShelfSummary;
  canCurate: boolean;
  onDelete: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: shelf.id });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
  };

  return (
    <div ref={setNodeRef} style={style}>
      <Card className="flex items-center gap-3 p-4">
        {canCurate && (
          <button
            {...attributes}
            {...listeners}
            className="shrink-0 w-5 flex items-center justify-center cursor-grab active:cursor-grabbing text-ink/30 hover:text-ink/60 select-none"
            aria-label="Drag to reorder"
            tabIndex={-1}
          >
            <Icon name="drag" />
          </button>
        )}
        <Link href={`/shelf/${shelf.id}`} className="min-w-0 flex-1">
          <div className="font-display text-lg font-bold leading-tight truncate">{shelf.name}</div>
          <div className="font-mono text-xs text-ink/50 mt-0.5">
            {shelf.item_count} item{shelf.item_count === 1 ? '' : 's'} · updated {relativeTime(shelf.updated_at)}
            {shelf.share_token && <span className="text-moss"> · shared</span>}
          </div>
        </Link>
        <Link
          href={`/shelf/${shelf.id}`}
          className="shrink-0 font-mono text-xs uppercase tracking-widest underline hover:text-rust"
        >
          Open →
        </Link>
        {canCurate && (
          <button
            onClick={onDelete}
            className="shrink-0 text-ink/20 hover:text-rust transition-colors"
            aria-label="Delete shelf"
          >
            <Icon name="remove" className="text-base" />
          </button>
        )}
      </Card>
    </div>
  );
}

export function ShelfView({
  displayName,
  isAdmin = false,
  isMod = false,
  canCurate = false,
}: {
  displayName: string;
  isAdmin?: boolean;
  isMod?: boolean;
  canCurate?: boolean;
}) {
  const [shelves, setShelves] = useState<ShelfSummary[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [newName, setNewName] = useState('');
  const [creating, setCreating] = useState(false);
  const { confirm, confirmDialog } = useConfirm();

  const refresh = useCallback(async () => {
    const r = await fetch('/api/lists');
    if (r.ok) {
      const data = await r.json();
      setShelves(data.lists || []);
    }
    setLoaded(true);
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const createShelf = async (e: React.FormEvent) => {
    e.preventDefault();
    if (creating) return;
    const name = newName.trim() || 'New shelf';
    setCreating(true);
    try {
      const r = await fetch('/api/lists', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      });
      if (r.ok) {
        const data = await r.json();
        setShelves((prev) => [data.list, ...prev]);
        setNewName('');
      } else {
        toast.error('Failed to create shelf');
      }
    } finally {
      setCreating(false);
    }
  };

  const deleteShelf = async (shelf: ShelfSummary) => {
    if (!(await confirm({
      title: `Delete “${shelf.name}”?`,
      description: `This can't be undone. ${shelf.item_count} item${shelf.item_count === 1 ? '' : 's'} will be removed with it.`,
      confirmText: 'Delete',
      destructive: true,
    }))) return;
    setShelves((prev) => prev.filter((s) => s.id !== shelf.id));
    await fetch(`/api/lists/${shelf.id}`, { method: 'DELETE' });
  };

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    setShelves((prev) => {
      const oldIndex = prev.findIndex((s) => s.id === active.id);
      const newIndex = prev.findIndex((s) => s.id === over.id);
      if (oldIndex < 0 || newIndex < 0) return prev;
      const reordered = arrayMove(prev, oldIndex, newIndex);
      fetch('/api/lists/reorder', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: reordered.map((s) => s.id) }),
      }).catch(() => {});
      return reordered;
    });
  };

  return (
    <div className="min-h-screen flex flex-col">
      {confirmDialog}
      <AppHeader
        className="border-b-2 border-ink px-6 py-3 gap-6"
        section="the shelf"
        right={
          <>
            {!isMod && <Link href="/deck" className="underline hover:text-rust">Streamer Deck</Link>}
            <Link href="/mod" className="underline hover:text-rust">Mod View</Link>
            {!isMod && <Link href="/setup" className="underline hover:text-rust">Settings</Link>}
            {isAdmin && <Link href="/admin" className="underline hover:text-rust">Admin</Link>}
            <span>{displayName}</span>
          </>
        }
      />

      <main className="px-6 py-8 max-w-3xl mx-auto w-full flex-1">
        <div className="mb-6">
          <h1 className="font-display text-3xl font-bold mb-2">The Shelf</h1>
          <p className="text-sm text-ink/60 max-w-xl">
            Durable, named lists of content — independent of today&apos;s run of show. Shelve
            something here when it&apos;s worth keeping but not for today, then send it to the
            deck whenever it&apos;s time.
          </p>
        </div>

        {canCurate && (
          <form onSubmit={createShelf} className="flex gap-2 mb-6">
            <Input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="New shelf name…"
              className="flex-1"
              disabled={creating}
            />
            <Button type="submit" disabled={creating}>
              {creating ? '…' : '+ Create'}
            </Button>
          </form>
        )}

        {!loaded ? (
          <div className="space-y-3">
            {[0, 1, 2].map((i) => <Skeleton key={i} className="h-20 w-full" />)}
          </div>
        ) : shelves.length === 0 ? (
          <div className="text-center py-16">
            <p className="font-display text-2xl mb-2">Nothing on the shelf yet.</p>
            <p className="text-ink/60 font-mono text-sm">
              {canCurate
                ? 'Create one above, or save an item to a new shelf straight from the deck or mod view.'
                : 'Ask your streamer to create one, or save an item to a new shelf from the deck or mod view.'}
            </p>
          </div>
        ) : (
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
            <SortableContext items={shelves.map((s) => s.id)} strategy={verticalListSortingStrategy}>
              <div className="space-y-2">
                {shelves.map((shelf) => (
                  <SortableShelfRow
                    key={shelf.id}
                    shelf={shelf}
                    canCurate={canCurate}
                    onDelete={() => deleteShelf(shelf)}
                  />
                ))}
              </div>
            </SortableContext>
          </DndContext>
        )}
      </main>
    </div>
  );
}

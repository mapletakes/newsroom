'use client';

import { useCallback, useEffect, useState } from 'react';
import { Input } from '@/components/ui/input';
import { Sheet, SheetClose, SheetContent, SheetTrigger, SheetTitle } from '@/components/ui/sheet';
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

type QuickLink = { id: string; label: string; url: string; position: number };

const host = (u: string) => {
  try {
    return new URL(u).hostname.replace(/^www\./, '');
  } catch {
    return u;
  }
};

function SortableLinkRow({
  link,
  onRemove,
}: {
  link: QuickLink;
  onRemove: (id: string) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: link.id,
  });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
  };

  return (
    <div ref={setNodeRef} style={style} className="group flex items-center gap-2 card-paper p-2">
      <button
        {...attributes}
        {...listeners}
        className="shrink-0 w-5 flex items-center justify-center cursor-grab active:cursor-grabbing text-ink/30 hover:text-ink/60 select-none"
        aria-label="Drag to reorder"
        tabIndex={-1}
      >
        ⠿
      </button>
      <a
        href={link.url}
        target="_blank"
        rel="noreferrer"
        className="min-w-0 flex-1 hover:text-rust"
      >
        <div className="font-display text-sm font-bold leading-tight truncate">
          {link.label}
        </div>
        <div className="font-mono text-[10px] text-ink/50 truncate">{host(link.url)}</div>
      </a>
      <a
        href={link.url}
        target="_blank"
        rel="noreferrer"
        className="shrink-0 text-ink/30 hover:text-ink"
        aria-label="Open in new tab"
      >
        <span className="material-icons text-base">open_in_new</span>
      </a>
      <button
        onClick={() => onRemove(link.id)}
        className="shrink-0 text-ink/20 hover:text-rust transition-colors"
        aria-label="Remove"
      >
        <span className="material-icons text-base">delete</span>
      </button>
    </div>
  );
}

// A streamer's personal "on-hand" links (fossabot, fundraisers, etc.), in a
// popout drawer that overlays the deck. Entirely separate from the queue.
export function QuickLinksDrawer() {
  const [links, setLinks] = useState<QuickLink[]>([]);
  const [label, setLabel] = useState('');
  const [url, setUrl] = useState('');
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    const r = await fetch('/api/quick-links');
    if (r.ok) {
      const d = await r.json();
      setLinks(d.links || []);
    }
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!url.trim() || adding) return;
    setAdding(true);
    setError('');
    try {
      const r = await fetch('/api/quick-links', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ label, url }),
      });
      if (r.ok) {
        const d = await r.json();
        setLinks((prev) => [...prev, d.link]);
        setLabel('');
        setUrl('');
      } else {
        const d = await r.json().catch(() => ({}));
        setError(d.error === 'invalid url' ? 'That doesn’t look like a URL.' : d.error || 'Failed to add');
      }
    } finally {
      setAdding(false);
    }
  };

  const remove = async (id: string) => {
    setLinks((prev) => prev.filter((l) => l.id !== id)); // optimistic
    await fetch('/api/quick-links', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id }),
    });
  };

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    setLinks((prev) => {
      const oldIndex = prev.findIndex((l) => l.id === active.id);
      const newIndex = prev.findIndex((l) => l.id === over.id);
      if (oldIndex < 0 || newIndex < 0) return prev;
      const reordered = arrayMove(prev, oldIndex, newIndex);
      fetch('/api/quick-links', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: reordered.map((l) => l.id) }),
      }).catch(() => {});
      return reordered;
    });
  };

  return (
    <Sheet>
      {/* Left-edge launcher tab — always reachable while running the show. */}
      <SheetTrigger asChild>
        <button
          className="fixed left-0 top-20 z-30 flex flex-col items-center gap-1.5 bg-ink text-paper px-1.5 py-3 rounded-r-sm shadow-lg hover:bg-rust transition-colors"
          aria-label="Open on-hand links"
          title="On-hand links"
        >
          <span className="material-icons text-lg">bookmarks</span>
          <span className="[writing-mode:vertical-rl] font-mono text-[10px] uppercase tracking-widest">
            Links
          </span>
        </button>
      </SheetTrigger>

      <SheetContent side="left">
        <div className="flex items-center gap-2 border-b-2 border-ink px-4 py-3">
          <span className="material-icons text-ink">bookmarks</span>
          <SheetTitle>On-hand links</SheetTitle>
          <SheetClose asChild>
            <button className="ml-auto text-ink/50 hover:text-rust" aria-label="Close">
              <span className="material-icons">close</span>
            </button>
          </SheetClose>
        </div>

        <form onSubmit={add} className="border-b border-ink/20 p-4 space-y-2">
          <Input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="Label (optional)"
            className="w-full text-xs"
          />
          <div className="flex gap-1">
            <Input
              type="text"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="Paste a URL…"
              className="flex-1 min-w-0 text-xs"
              disabled={adding}
            />
            <button
              type="submit"
              disabled={adding || !url.trim()}
              className="shrink-0 font-mono text-xs uppercase tracking-widest bg-ink text-paper px-3 py-1.5 hover:bg-rust transition-colors disabled:opacity-40"
            >
              {adding ? '…' : 'Add'}
            </button>
          </div>
          {error && <div className="font-mono text-[10px] text-rust">{error}</div>}
        </form>

        <div className="flex-1 overflow-y-auto p-3 space-y-1">
          {links.length === 0 ? (
            <p className="font-mono text-[11px] text-ink/40 px-2 py-6 text-center leading-relaxed">
              No links yet. Stash fossabot, fundraisers, giveaway pages — anything
              you want one click away during the show.
            </p>
          ) : (
            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              onDragEnd={handleDragEnd}
            >
              <SortableContext items={links.map((l) => l.id)} strategy={verticalListSortingStrategy}>
                {links.map((l) => (
                  <SortableLinkRow key={l.id} link={l} onRemove={remove} />
                ))}
              </SortableContext>
            </DndContext>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

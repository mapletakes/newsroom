'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Input } from '@/components/ui/input';
import { Sheet, SheetClose, SheetContent, SheetTrigger, SheetTitle } from '@/components/ui/sheet';
import { Icon } from '@/components/ui/icon';
import { RailTab } from '@/components/DeckRail';
import { queryKeys } from '@/lib/query-keys';
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

async function fetchQuickLinks(): Promise<QuickLink[]> {
  const r = await fetch('/api/quick-links');
  if (!r.ok) return [];
  const d = await r.json();
  return d.links || [];
}

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
        <Icon name="external" className="text-base" />
      </a>
      <button
        onClick={() => onRemove(link.id)}
        className="shrink-0 text-ink/20 hover:text-rust transition-colors"
        aria-label="Remove"
      >
        <Icon name="remove" className="text-base" />
      </button>
    </div>
  );
}

// A streamer's personal "on-hand" links (fossabot, fundraisers, etc.), in a
// popout drawer that overlays the deck. Entirely separate from the queue.
export function QuickLinksDrawer() {
  const queryClient = useQueryClient();
  const linksKey = queryKeys.quickLinks();
  const { data } = useQuery({ queryKey: linksKey, queryFn: fetchQuickLinks });
  const links = data ?? [];

  const [label, setLabel] = useState('');
  const [url, setUrl] = useState('');
  const [error, setError] = useState('');

  const addMutation = useMutation({
    mutationFn: async (vars: { label: string; url: string }) => {
      const r = await fetch('/api/quick-links', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(vars),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error === 'invalid url' ? 'That doesn’t look like a URL.' : d.error || 'Failed to add');
      return d.link as QuickLink;
    },
    onSuccess: (link) => {
      queryClient.setQueryData<QuickLink[]>(linksKey, (prev = []) => [...prev, link]);
      setLabel('');
      setUrl('');
      setError('');
    },
    onError: (err: Error) => setError(err.message),
  });

  const add = (e: React.FormEvent) => {
    e.preventDefault();
    if (!url.trim() || addMutation.isPending) return;
    setError('');
    addMutation.mutate({ label, url });
  };

  const removeMutation = useMutation({
    mutationFn: async (id: string) => {
      await fetch('/api/quick-links', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      });
    },
    onMutate: async (id) => {
      await queryClient.cancelQueries({ queryKey: linksKey });
      const previous = queryClient.getQueryData<QuickLink[]>(linksKey);
      queryClient.setQueryData<QuickLink[]>(linksKey, (prev = []) => prev.filter((l) => l.id !== id));
      return { previous };
    },
    onError: (_err, _id, context) => {
      if (context?.previous) queryClient.setQueryData(linksKey, context.previous);
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: linksKey }),
  });

  const reorderMutation = useMutation({
    mutationFn: async (ids: string[]) => {
      await fetch('/api/quick-links', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids }),
      });
    },
  });

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = links.findIndex((l) => l.id === active.id);
    const newIndex = links.findIndex((l) => l.id === over.id);
    if (oldIndex < 0 || newIndex < 0) return;
    const reordered = arrayMove(links, oldIndex, newIndex);
    queryClient.setQueryData(linksKey, reordered);
    reorderMutation.mutate(reordered.map((l) => l.id));
  };

  return (
    <Sheet>
      {/* Positioned by DeckRail, not by itself — see components/DeckRail.tsx. */}
      <SheetTrigger asChild>
        <RailTab icon="bookmark" label="Links" />
      </SheetTrigger>

      <SheetContent side="left">
        <div className="flex items-center gap-2 border-b-2 border-ink px-4 py-3">
          <Icon name="bookmark" className="text-ink" />
          <SheetTitle>On-hand links</SheetTitle>
          <SheetClose asChild>
            <button className="ml-auto text-ink/50 hover:text-rust" aria-label="Close">
              <Icon name="close" />
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
              disabled={addMutation.isPending}
            />
            <button
              type="submit"
              disabled={addMutation.isPending || !url.trim()}
              className="shrink-0 font-mono text-xs uppercase tracking-widest bg-ink text-paper px-3 py-1.5 hover:bg-rust transition-colors disabled:opacity-40"
            >
              {addMutation.isPending ? '…' : 'Add'}
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
                  <SortableLinkRow key={l.id} link={l} onRemove={(id) => removeMutation.mutate(id)} />
                ))}
              </SortableContext>
            </DndContext>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

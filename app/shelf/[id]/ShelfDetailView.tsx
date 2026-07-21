'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AppHeader } from '@/components/AppHeader';
import { Button, buttonVariants } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Icon } from '@/components/ui/icon';
import { SimpleTooltip } from '@/components/ui/tooltip';
import { useConfirm } from '@/components/ui/confirm-dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { formatDuration, formatDate, relativeTime, kindTint } from '@/lib/url';
import { positionsFromOrder, insertAtIndex, isSameOrder } from '@/lib/reorder';
import { queryKeys } from '@/lib/query-keys';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import {
  DndContext,
  DragOverlay,
  closestCorners,
  KeyboardSensor,
  MeasuringStrategy,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

type ShelfItem = {
  id: string;
  url: string;
  kind: string;
  title: string | null;
  thumbnail_url: string | null;
  publisher: string | null;
  duration_seconds: number | null;
  published_at: string | null;
  description: string | null;
  summary: string | null;
  credibility_tag: string | null;
  topics: string[] | null;
  dmca_risk: string | null;
  content_warning: string | null;
  note: string | null;
  added_by: string | null;
  segment_id: string | null;
  position: number | null;
  created_at: string;
};

type ShelfSegment = { id: string; name: string; position: number };
type ShelfMeta = { id: string; name: string; share_token: string | null; ungrouped_position: number };
type ShelfData = { list: ShelfMeta; items: ShelfItem[]; segments: ShelfSegment[] };
type DeckSegment = { id: string; name: string };

async function fetchShelf(shelfId: string): Promise<ShelfData> {
  const r = await fetch(`/api/lists/${shelfId}`);
  if (!r.ok) throw new Error('Failed to load shelf');
  const data = await r.json();
  return { list: data.list, items: data.items || [], segments: data.segments || [] };
}

async function fetchDeckSegments(): Promise<DeckSegment[]> {
  const r = await fetch('/api/segments');
  if (!r.ok) return [];
  const data = await r.json();
  return data.segments || [];
}

// A "Send to deck" button that becomes a dropdown (ungrouped + each deck
// segment) once the stream has any segments defined — otherwise it's a
// single click straight to ungrouped. Shared by the per-item row and the
// shelf-level "Send all" action. Distinct from rundown-mode sending, which
// targets the shelf's OWN block structure rather than one chosen deck segment.
function SendToDeckMenu({
  segments,
  onSend,
  label = 'Send to deck',
  size = 'sm',
}: {
  segments: DeckSegment[];
  onSend: (segmentId: string | null, label: string) => void;
  label?: string;
  size?: 'xs' | 'sm';
}) {
  if (segments.length === 0) {
    return (
      <Button variant="outline" size={size} onClick={() => onSend(null, '')}>
        {label}
      </Button>
    );
  }
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size={size}>
          {label} <Icon name="expand" className="text-xs ml-0.5" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        <DropdownMenuLabel>Send to</DropdownMenuLabel>
        <DropdownMenuItem onSelect={() => onSend(null, 'Ungrouped')}>Ungrouped</DropdownMenuItem>
        <DropdownMenuSeparator />
        {segments.map((s) => (
          <DropdownMenuItem key={s.id} onSelect={() => onSend(s.id, s.name)}>
            {s.name}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function SortableItemRow({
  item,
  canCurate,
  deckSegments,
  onRemove,
  onSend,
  onNoteCommit,
}: {
  item: ShelfItem;
  canCurate: boolean;
  deckSegments: DeckSegment[];
  onRemove: () => void;
  onSend: (segmentId: string | null, label: string) => void;
  onNoteCommit: (note: string) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: item.id });
  const style = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0 : 1 };

  const [showNote, setShowNote] = useState(!!item.note);
  const [note, setNote] = useState(item.note || '');

  return (
    <div ref={setNodeRef} style={style}>
      <Card className={cn(kindTint(item.kind), 'p-4 flex gap-3')}>
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
        {item.thumbnail_url && (
          <img
            src={item.thumbnail_url}
            alt=""
            className="shrink-0 w-28 h-[4.5rem] object-cover border border-ink/20"
            loading="lazy"
          />
        )}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 mb-1 flex-wrap font-mono text-xs uppercase tracking-widest">
            <Badge variant="outline">{item.kind.replace('_', ' ')}</Badge>
            {item.duration_seconds ? <span className="text-ink/60">{formatDuration(item.duration_seconds)}</span> : null}
            {item.credibility_tag && <Badge variant="outline">{item.credibility_tag}</Badge>}
            {item.dmca_risk === 'high' && <span className="text-rust font-bold">⚠ high DMCA risk</span>}
            {item.dmca_risk === 'medium' && <span className="text-ochre">◐ medium DMCA risk</span>}
            {item.content_warning && (
              <SimpleTooltip content={item.content_warning}>
                <span className="text-rust font-bold cursor-default">⚠ CW</span>
              </SimpleTooltip>
            )}
          </div>
          <div className="font-display text-lg font-bold leading-tight mb-1">{item.title || item.url}</div>
          <div className="font-mono text-xs text-ink/50 mb-1 truncate">
            {item.publisher}
            {item.published_at && ` · ${formatDate(item.published_at)}`}
            {item.added_by && <> · added by <strong>{item.added_by}</strong></>}
            {' · '}{relativeTime(item.created_at)}
          </div>
          {(item.summary || item.description) && (
            <p className="text-sm text-ink/70 leading-snug line-clamp-2 mb-2">{item.summary || item.description}</p>
          )}
          {item.topics && item.topics.length > 0 && (
            <div className="flex flex-wrap gap-1 mb-2">
              {item.topics.map((t) => (
                <span key={t} className="font-mono text-[10px] uppercase bg-paper border border-ink/30 px-1.5 py-0.5">
                  #{t}
                </span>
              ))}
            </div>
          )}
          {showNote ? (
            <Input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              onBlur={() => onNoteCommit(note)}
              onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
              placeholder="Why this? What's the angle?"
              className="w-full text-xs mb-2"
              disabled={!canCurate}
            />
          ) : null}
          <div className="flex items-center gap-2 flex-wrap">
            <a href={item.url} target="_blank" rel="noreferrer" className={buttonVariants({ variant: 'outline', size: 'xs' })}>
              Open ↗
            </a>
            {canCurate && <SendToDeckMenu segments={deckSegments} onSend={onSend} size="xs" />}
            {canCurate && !showNote && (
              <button
                onClick={() => setShowNote(true)}
                className="font-mono text-xs uppercase tracking-widest text-ink/50 hover:text-ink"
              >
                + add note
              </button>
            )}
            {canCurate && (
              <button
                onClick={onRemove}
                className="ml-auto shrink-0 text-ink/20 hover:text-rust transition-colors"
                aria-label="Remove from shelf"
              >
                <Icon name="remove" className="text-base" />
              </button>
            )}
          </div>
        </div>
      </Card>
    </div>
  );
}

// A named block within the shelf — mirrors the deck's SegmentBlock, minus
// the parts that don't apply here: no active-item highlighting, no type
// filter, no multi-select, no "clear all" (shelf items are removed one at a
// time, not rejected in bulk). Collapse state is local/ephemeral — blocks
// here are a planning aid, not something worth a schema column to persist.
function ShelfSegmentBlock({
  containerId,
  title,
  editable,
  items,
  canCurate,
  deckSegments,
  draggingSourceContainer,
  overContainerId,
  sortable,
  onRemoveItem,
  onSendItem,
  onNoteCommit,
  onRenameLocal,
  onRenameCommit,
  onDelete,
}: {
  containerId: string;
  title: string | null;
  editable: boolean;
  items: ShelfItem[];
  canCurate: boolean;
  deckSegments: DeckSegment[];
  draggingSourceContainer: string | null;
  overContainerId: string | null;
  sortable: boolean;
  onRemoveItem: (id: string) => void;
  onSendItem: (id: string, segmentId: string | null, label: string) => void;
  onNoteCommit: (id: string, note: string) => void;
  onRenameLocal?: (name: string) => void;
  onRenameCommit?: () => void;
  onDelete?: () => void;
}) {
  const { setNodeRef, attributes, listeners, transform, transition, isDragging } = useSortable({ id: containerId });
  const [collapsed, setCollapsed] = useState(false);

  const isDropTarget =
    overContainerId === containerId && draggingSourceContainer !== null && draggingSourceContainer !== containerId;

  const style = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.4 : 1 };

  return (
    <div ref={setNodeRef} style={style} className={`mb-4 rounded-sm transition-colors ${isDropTarget ? 'ring-2 ring-rust bg-rust/5' : ''}`}>
      {title !== null && (
        <div className="flex items-center gap-1 mb-2 bg-ink/10 px-1 py-1">
          {sortable && canCurate && (
            <button
              {...attributes}
              {...listeners}
              className="shrink-0 w-5 flex items-center justify-center cursor-grab active:cursor-grabbing text-ink/30 hover:text-ink/60 select-none"
              aria-label="Drag to reorder segment"
              tabIndex={-1}
            >
              ⠿
            </button>
          )}
          <button
            onClick={() => setCollapsed((c) => !c)}
            className="shrink-0 w-5 text-ink/60 hover:text-ink"
            aria-label={collapsed ? 'Expand' : 'Collapse'}
          >
            {collapsed ? '▸' : '▾'}
          </button>
          {editable && canCurate ? (
            <input
              value={title}
              size={Math.min(Math.max(title.length + 1, 6), 28)}
              onChange={(e) => onRenameLocal?.(e.target.value)}
              onBlur={() => onRenameCommit?.()}
              onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
              className="min-w-0 shrink bg-transparent font-mono text-xs uppercase tracking-widest font-bold focus:outline-none focus:bg-paper px-1 py-0.5"
            />
          ) : (
            <span className="min-w-0 font-mono text-xs uppercase tracking-widest font-bold text-ink/50 px-1 py-0.5 truncate max-w-[12rem]">
              {title}
            </span>
          )}
          <span className="mr-auto shrink-0 font-mono text-xs font-semibold text-ink/60">({items.length})</span>
          {onDelete && canCurate && (
            <button onClick={onDelete} className="shrink-0 w-5 flex items-center justify-center text-ink/30 hover:text-rust" aria-label="Delete segment">
              <Icon name="remove" className="text-sm" />
            </button>
          )}
        </div>
      )}
      {!collapsed ? (
        <SortableContext items={items.map((i) => i.id)} strategy={verticalListSortingStrategy}>
          <div className="space-y-3 min-h-[2rem]">
            {items.map((item) => (
              <SortableItemRow
                key={item.id}
                item={item}
                canCurate={canCurate}
                deckSegments={deckSegments}
                onRemove={() => onRemoveItem(item.id)}
                onSend={(seg, label) => onSendItem(item.id, seg, label)}
                onNoteCommit={(note) => onNoteCommit(item.id, note)}
              />
            ))}
            {isDropTarget && items.length === 0 && (
              <div className="border-2 border-dashed border-rust bg-rust/10 px-2 py-2 text-center font-mono text-[10px] uppercase tracking-widest text-rust">
                Drop here
              </div>
            )}
            {title !== null && items.length === 0 && !isDropTarget && (
              <div className="font-mono text-[10px] text-ink/40 px-6 py-2 italic">empty — drag items here</div>
            )}
          </div>
        </SortableContext>
      ) : (
        isDropTarget && (
          <div className="border-2 border-dashed border-rust bg-rust/10 px-2 py-2 text-center font-mono text-[10px] uppercase tracking-widest text-rust">
            Drop to add here
          </div>
        )
      )}
    </div>
  );
}

export function ShelfDetailView({
  shelfId,
  streamId,
  displayName,
  isAdmin = false,
  isMod = false,
  canCurate = false,
}: {
  shelfId: string;
  streamId: string;
  displayName: string;
  isAdmin?: boolean;
  isMod?: boolean;
  canCurate?: boolean;
}) {
  const queryClient = useQueryClient();
  const shelfKey = queryKeys.shelf(shelfId);
  const { confirm, confirmDialog } = useConfirm();

  // A slow backstop poll is enough here — no realtime channel for the shelf
  // (lower-urgency surface than the live queue). refetchIntervalInBackground
  // defaults to false, so this already pauses while the tab is hidden, same
  // as the hand-rolled useVisiblePoll it replaces.
  const { data, isPending } = useQuery({
    queryKey: shelfKey,
    queryFn: () => fetchShelf(shelfId),
    refetchInterval: 30000,
  });
  const shelf = data?.list ?? null;
  const items = useMemo(() => data?.items ?? [], [data]);
  const segments = useMemo(() => data?.segments ?? [], [data]);

  const { data: deckSegments = [] } = useQuery({ queryKey: queryKeys.segments(streamId), queryFn: fetchDeckSegments });

  const [name, setName] = useState('');
  const editingNameRef = useRef(false);
  useEffect(() => {
    if (shelf && !editingNameRef.current) setName(shelf.name);
  }, [shelf]);

  // A block name being typed lives here, not the query cache — same
  // reasoning as the shelf's own name/editingNameRef above and DeckView's
  // segment rename: keeps a background refetch from clobbering an
  // in-progress rename.
  const [editingSegment, setEditingSegment] = useState<{ id: string; name: string } | null>(null);

  const [addUrl, setAddUrl] = useState('');

  const renameMutation = useMutation({
    mutationFn: async (newName: string) => {
      await fetch(`/api/lists/${shelfId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newName }),
      });
    },
    onSuccess: (_void, newName) => {
      queryClient.setQueryData<ShelfData>(shelfKey, (prev) =>
        prev ? { ...prev, list: { ...prev.list, name: newName } } : prev);
    },
  });

  const commitName = () => {
    editingNameRef.current = false;
    const trimmed = name.trim();
    if (!trimmed || trimmed === shelf?.name) {
      if (shelf) setName(shelf.name);
      return;
    }
    renameMutation.mutate(trimmed);
  };

  const addUrlMutation = useMutation({
    mutationFn: async (url: string) => {
      const r = await fetch(`/api/lists/${shelfId}/items`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url }),
      });
      if (!r.ok) throw new Error('Failed to add');
      return r.json();
    },
    onSuccess: (result) => {
      setAddUrl('');
      if (result.added > 0) {
        toast.success('Added to the shelf');
        queryClient.invalidateQueries({ queryKey: shelfKey });
      } else {
        toast('Already on this shelf');
      }
    },
    onError: () => toast.error('Failed to add'),
  });

  const handleAddUrl = (e: React.FormEvent) => {
    e.preventDefault();
    const url = addUrl.trim();
    if (!url || addUrlMutation.isPending) return;
    addUrlMutation.mutate(url);
  };

  const removeItemMutation = useMutation({
    mutationFn: async (id: string) => {
      await fetch(`/api/lists/${shelfId}/items/${id}`, { method: 'DELETE' });
    },
    onMutate: async (id) => {
      await queryClient.cancelQueries({ queryKey: shelfKey });
      const previous = queryClient.getQueryData<ShelfData>(shelfKey);
      queryClient.setQueryData<ShelfData>(shelfKey, (prev) =>
        prev ? { ...prev, items: prev.items.filter((i) => i.id !== id) } : prev);
      return { previous };
    },
    onError: (_err, _id, context) => {
      if (context?.previous) queryClient.setQueryData(shelfKey, context.previous);
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: shelfKey }),
  });

  const noteMutation = useMutation({
    mutationFn: async ({ id, note }: { id: string; note: string }) => {
      await fetch(`/api/lists/${shelfId}/items/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ note: note || null }),
      });
    },
  });

  const sendToDeckMutation = useMutation({
    mutationFn: async (vars: { itemIds: string[] | null; segmentId: string | null; mode?: 'rundown' }) => {
      const r = await fetch(`/api/lists/${shelfId}/send-to-deck`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(vars),
      });
      if (!r.ok) throw new Error('Failed to send to deck');
      return r.json();
    },
    onError: () => toast.error('Failed to send to deck'),
  });

  const sendToDeck = (itemIds: string[] | null, segmentId: string | null, segLabel: string) => {
    sendToDeckMutation.mutate({ itemIds, segmentId }, {
      onSuccess: (result) => {
        if (result.added > 0) {
          toast.success(`Sent ${result.added} to deck${segLabel ? ` — ${segLabel}` : ''}${result.skipped ? ` (${result.skipped} already there)` : ''}`);
        } else {
          toast(result.skipped ? 'Already on the deck' : 'Nothing to send');
        }
      },
    });
  };

  const sendRundown = () => {
    sendToDeckMutation.mutate({ itemIds: null, segmentId: null, mode: 'rundown' }, {
      onSuccess: (result) => {
        if (result.added > 0) {
          toast.success(
            `Sent ${result.added} to deck across ${result.segmentsCreated} new segment${result.segmentsCreated === 1 ? '' : 's'}${result.skipped ? ` (${result.skipped} already there)` : ''}`,
          );
        } else {
          toast(result.skipped ? 'Already on the deck' : 'Nothing to send');
        }
      },
    });
  };

  const [copied, setCopied] = useState(false);
  const shareUrl = shelf?.share_token && typeof window !== 'undefined'
    ? `${window.location.origin}/l/${shelf.share_token}`
    : '';

  const shareMutation = useMutation({
    mutationFn: async () => {
      const r = await fetch(`/api/lists/${shelfId}/share`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      if (!r.ok) throw new Error('Failed to create share link');
      return r.json();
    },
    onSuccess: (result) => {
      queryClient.setQueryData<ShelfData>(shelfKey, (prev) =>
        prev ? { ...prev, list: { ...prev.list, share_token: result.token } } : prev);
    },
    onError: () => toast.error('Failed to create share link'),
  });

  const revokeMutation = useMutation({
    mutationFn: async () => {
      await fetch(`/api/lists/${shelfId}/share`, { method: 'DELETE' });
    },
    onSuccess: () => {
      queryClient.setQueryData<ShelfData>(shelfKey, (prev) =>
        prev ? { ...prev, list: { ...prev.list, share_token: null } } : prev);
    },
  });

  const revokeShareLink = async () => {
    if (!(await confirm({
      title: 'Revoke this share link?',
      description: 'The current link will stop working. You can generate a new one anytime.',
      confirmText: 'Revoke',
      destructive: true,
    }))) return;
    revokeMutation.mutate();
  };

  const copyShareLink = async () => {
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch { /* clipboard unavailable */ }
  };

  const deleteShelfMutation = useMutation({
    mutationFn: async () => {
      await fetch(`/api/lists/${shelfId}`, { method: 'DELETE' });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.shelves() });
      window.location.href = '/shelf';
    },
  });

  const deleteShelf = async () => {
    if (!shelf) return;
    if (!(await confirm({
      title: `Delete “${shelf.name}”?`,
      description: `This can't be undone. ${items.length} item${items.length === 1 ? '' : 's'} will be removed with it.`,
      confirmText: 'Delete',
      destructive: true,
    }))) return;
    deleteShelfMutation.mutate();
  };

  // Renumbers positions for whichever ids are passed — same-block reorder
  // just passes that block's own items, so this needs no grouping awareness.
  const reorderMutation = useMutation({
    mutationFn: async (ids: string[]) => {
      await fetch(`/api/lists/${shelfId}/items/reorder`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids }),
      });
    },
  });

  // Cross-block move: reassigns segment_id for the moved item and renumbers
  // the full target block.
  const moveItemMutation = useMutation({
    mutationFn: async (vars: { ids: string[]; segmentId: string | null; orderedIds: string[] }) => {
      await fetch(`/api/lists/${shelfId}/items/move`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(vars),
      });
    },
  });

  const addSegmentMutation = useMutation({
    mutationFn: async () => {
      const r = await fetch(`/api/lists/${shelfId}/segments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'New segment' }),
      });
      if (!r.ok) throw new Error('Failed to add segment');
      return r.json();
    },
    onSuccess: (result) => {
      queryClient.setQueryData<ShelfData>(shelfKey, (prev) =>
        prev ? { ...prev, segments: [result.segment, ...prev.segments] } : prev);
    },
    onError: () => toast.error('Failed to add segment'),
  });

  const renameSegmentMutation = useMutation({
    mutationFn: async (vars: { id: string; name: string }) => {
      await fetch(`/api/lists/${shelfId}/segments`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(vars),
      });
    },
  });

  const renameSegmentLocal = (id: string, name: string) => setEditingSegment({ id, name });

  const commitSegmentRename = (id: string) => {
    const name = editingSegment?.id === id ? editingSegment.name : segments.find((s) => s.id === id)?.name;
    setEditingSegment(null);
    if (name == null) return;
    queryClient.setQueryData<ShelfData>(shelfKey, (prev) =>
      prev ? { ...prev, segments: prev.segments.map((s) => (s.id === id ? { ...s, name } : s)) } : prev);
    renameSegmentMutation.mutate({ id, name });
  };

  const deleteSegmentMutation = useMutation({
    mutationFn: async (id: string) => {
      await fetch(`/api/lists/${shelfId}/segments`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      });
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: shelfKey }),
  });

  const deleteSegment = async (id: string) => {
    if (!(await confirm({
      title: 'Delete this segment?',
      description: 'Its items move back to Ungrouped.',
      confirmText: 'Delete',
      destructive: true,
    }))) return;
    queryClient.setQueryData<ShelfData>(shelfKey, (prev) =>
      prev ? { ...prev, segments: prev.segments.filter((s) => s.id !== id) } : prev);
    deleteSegmentMutation.mutate(id);
  };

  const reorderSegmentsMutation = useMutation({
    mutationFn: async (ids: string[]) => {
      await fetch(`/api/lists/${shelfId}/segments/reorder`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids }),
      });
    },
  });

  // --- Block derivation (mirrors DeckView's blocks/containerOf/containerItems) ---
  const blocks = useMemo(() => {
    const arr: { id: string; segment: ShelfSegment | null; position: number }[] = [
      { id: 'ungrouped', segment: null, position: shelf?.ungrouped_position ?? 0 },
      ...segments.map((s) => ({ id: s.id, segment: s, position: s.position })),
    ];
    arr.sort((a, b) => a.position - b.position);
    return arr;
  }, [segments, shelf]);
  const blockIds = useMemo(() => blocks.map((b) => b.id), [blocks]);
  const knownSegmentIds = useMemo(() => new Set(segments.map((s) => s.id)), [segments]);
  const ungroupedItems = useMemo(
    () => items.filter((i) => !i.segment_id || !knownSegmentIds.has(i.segment_id)),
    [items, knownSegmentIds],
  );
  const itemsForSegment = useCallback((segId: string) => items.filter((i) => i.segment_id === segId), [items]);
  const containerOf = useCallback(
    (itemId: string): string => {
      const item = items.find((i) => i.id === itemId);
      if (item?.segment_id && knownSegmentIds.has(item.segment_id)) return item.segment_id;
      return 'ungrouped';
    },
    [items, knownSegmentIds],
  );
  const containerItems = useCallback(
    (containerId: string): ShelfItem[] => (containerId === 'ungrouped' ? ungroupedItems : itemsForSegment(containerId)),
    [ungroupedItems, itemsForSegment],
  );
  const isBlockId = useCallback((id: string) => id === 'ungrouped' || knownSegmentIds.has(id), [knownSegmentIds]);

  // --- Drag and drop (two-level: blocks, then items within/across blocks) ---
  const [activeDragId, setActiveDragId] = useState<string | null>(null);
  const [overContainer, setOverContainer] = useState<string | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const endDrag = () => {
    setActiveDragId(null);
    setOverContainer(null);
  };

  const handleDragStart = (event: DragStartEvent) => setActiveDragId(String(event.active.id));

  const handleDragOver = (event: DragOverEvent) => {
    const { active, over } = event;
    if (isBlockId(String(active.id))) { setOverContainer(null); return; }
    if (!over) { setOverContainer(null); return; }
    const overId = String(over.id);
    setOverContainer(isBlockId(overId) ? overId : containerOf(overId));
  };

  const persistItemOrder = (containerId: string, reordered: ShelfItem[]) => {
    const pos = positionsFromOrder(reordered.map((i) => i.id));
    queryClient.setQueryData<ShelfData>(shelfKey, (prev) => {
      if (!prev) return prev;
      return { ...prev, items: prev.items.map((i) => (pos.has(i.id) ? { ...i, position: pos.get(i.id)! } : i)) };
    });
    reorderMutation.mutate(reordered.map((i) => i.id));
  };

  const moveItem = (itemId: string, targetContainer: string, orderedTargetIds: string[]) => {
    const segId = targetContainer === 'ungrouped' ? null : targetContainer;
    const pos = positionsFromOrder(orderedTargetIds);
    queryClient.setQueryData<ShelfData>(shelfKey, (prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        items: prev.items.map((i) => {
          if (i.id === itemId) return { ...i, segment_id: segId, position: pos.get(i.id) ?? i.position };
          const p = pos.get(i.id);
          return p !== undefined ? { ...i, position: p } : i;
        }),
      };
    });
    moveItemMutation.mutate({ ids: [itemId], segmentId: segId, orderedIds: orderedTargetIds });
  };

  const persistBlockOrder = (orderedIds: string[]) => {
    const pos = positionsFromOrder(orderedIds);
    queryClient.setQueryData<ShelfData>(shelfKey, (prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        segments: prev.segments.map((s) => ({ ...s, position: pos.get(s.id) ?? s.position })),
        list: { ...prev.list, ungrouped_position: pos.has('ungrouped') ? pos.get('ungrouped')! : prev.list.ungrouped_position },
      };
    });
    reorderSegmentsMutation.mutate(orderedIds);
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active: dragged, over } = event;
    if (!over) { endDrag(); return; }
    const draggedId = String(dragged.id);
    const overId = String(over.id);

    // Block reorder.
    if (isBlockId(draggedId)) {
      const overBlockId = isBlockId(overId) ? overId : containerOf(overId);
      if (draggedId !== overBlockId) {
        const oldIndex = blocks.findIndex((b) => b.id === draggedId);
        const newIndex = blocks.findIndex((b) => b.id === overBlockId);
        if (oldIndex >= 0 && newIndex >= 0) {
          persistBlockOrder(arrayMove(blocks, oldIndex, newIndex).map((b) => b.id));
        }
      }
      endDrag();
      return;
    }

    // Item drag.
    const sourceContainer = containerOf(draggedId);
    const targetContainer = isBlockId(overId) ? overId : containerOf(overId);
    const targetItems = containerItems(targetContainer);

    if (sourceContainer === targetContainer && !isBlockId(overId)) {
      const fromIdx = targetItems.findIndex((i) => i.id === draggedId);
      const toIdx = targetItems.findIndex((i) => i.id === overId);
      if (fromIdx >= 0 && toIdx >= 0 && fromIdx !== toIdx) {
        persistItemOrder(targetContainer, arrayMove(targetItems, fromIdx, toIdx));
      }
      endDrag();
      return;
    }

    const draggedItem = items.find((i) => i.id === draggedId);
    if (!draggedItem) { endDrag(); return; }
    const remaining = targetItems.filter((i) => i.id !== draggedId);
    const overIdx = isBlockId(overId) ? -1 : remaining.findIndex((i) => i.id === overId);
    const result = insertAtIndex(remaining, [draggedItem], overIdx);

    if (sourceContainer === targetContainer && isSameOrder(result, targetItems)) { endDrag(); return; }

    moveItem(draggedId, targetContainer, result.map((i) => i.id));
    endDrag();
  };

  const draggingBlock = activeDragId !== null && isBlockId(activeDragId);
  const activeDragItem = activeDragId && !draggingBlock ? items.find((i) => i.id === activeDragId) || null : null;
  const activeDragBlock = draggingBlock ? blocks.find((b) => b.id === activeDragId) || null : null;
  const draggingSourceContainer = activeDragItem ? containerOf(activeDragItem.id) : null;

  return (
    <div className="min-h-screen flex flex-col">
      {confirmDialog}
      <AppHeader
        className="border-b-2 border-ink px-6 py-3 gap-6"
        section={<>the shelf</>}
        right={
          <>
            <Link href="/shelf" className="underline hover:text-rust">← The Shelf</Link>
            {!isMod && <Link href="/deck" className="underline hover:text-rust">Streamer Deck</Link>}
            <Link href="/mod" className="underline hover:text-rust">Mod View</Link>
            {isAdmin && <Link href="/admin" className="underline hover:text-rust">Admin</Link>}
            <span>{displayName}</span>
          </>
        }
      />

      <main className="px-6 py-8 max-w-3xl mx-auto w-full flex-1">
        {isPending ? (
          <Skeleton className="h-9 w-64 mb-6" />
        ) : (
          <div className="flex items-start justify-between gap-4 mb-2 flex-wrap">
            {canCurate ? (
              <input
                value={name}
                onChange={(e) => { editingNameRef.current = true; setName(e.target.value); }}
                onBlur={commitName}
                onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
                className="min-w-0 flex-1 font-display text-3xl font-bold bg-transparent focus:outline-none focus:bg-ink/5 -mx-1 px-1"
              />
            ) : (
              <h1 className="font-display text-3xl font-bold">{name}</h1>
            )}
            {canCurate && (
              <button onClick={deleteShelf} className="shrink-0 font-mono text-xs uppercase tracking-widest text-ink/40 hover:text-rust">
                Delete shelf
              </button>
            )}
          </div>
        )}

        <div className="flex items-center gap-3 mb-6 flex-wrap">
          <span className="font-mono text-xs uppercase tracking-widest text-ink/60">
            {items.length} item{items.length === 1 ? '' : 's'}
          </span>
          {canCurate && items.length > 0 && (
            <SendToDeckMenu segments={deckSegments} onSend={(seg, label) => sendToDeck(null, seg, label)} label="Send all to deck" />
          )}
          {canCurate && segments.length > 0 && (
            <SimpleTooltip content="Sends every block as its own fresh segment on the deck, in order — the shelf keeps its structure and can be sent again later.">
              <Button size="sm" onClick={sendRundown} disabled={sendToDeckMutation.isPending}>
                Send rundown to deck →
              </Button>
            </SimpleTooltip>
          )}
          {canCurate && (
            <Button variant="outline" size="xs" onClick={() => addSegmentMutation.mutate()} className="ml-auto border-ink/30">
              + Segment
            </Button>
          )}
        </div>

        {canCurate && (
          <div className="flex items-center gap-2 mb-6 flex-wrap">
            {shelf?.share_token ? (
              <>
                <Input
                  readOnly
                  value={shareUrl}
                  onFocus={(e) => e.currentTarget.select()}
                  className="flex-1 min-w-0 text-xs bg-ink/10 border-ink/20"
                  aria-label="Share link"
                />
                <Button variant="outline" size="sm" onClick={copyShareLink}>{copied ? 'Copied!' : 'Copy link'}</Button>
                <Button variant="outlineDestructive" size="sm" onClick={revokeShareLink}>Revoke</Button>
              </>
            ) : (
              <Button variant="outline" size="sm" onClick={() => shareMutation.mutate()} disabled={shareMutation.isPending}>
                {shareMutation.isPending ? '…' : 'Share with another streamer…'}
              </Button>
            )}
          </div>
        )}

        {canCurate && (
          <form onSubmit={handleAddUrl} className="flex gap-2 mb-6">
            <Input
              type="url"
              value={addUrl}
              onChange={(e) => setAddUrl(e.target.value)}
              placeholder="Paste a link to add it to this shelf…"
              className="flex-1"
              disabled={addUrlMutation.isPending}
            />
            <Button type="submit" disabled={addUrlMutation.isPending || !addUrl.trim()}>
              {addUrlMutation.isPending ? '…' : 'Add'}
            </Button>
          </form>
        )}

        {isPending ? (
          <div className="space-y-3">
            {[0, 1, 2].map((i) => <Skeleton key={i} className="h-32 w-full" />)}
          </div>
        ) : items.length === 0 && segments.length === 0 ? (
          <div className="text-center py-16">
            <p className="font-display text-2xl mb-2">Nothing here yet.</p>
            <p className="text-ink/60 font-mono text-sm">
              {canCurate
                ? 'Paste a link above, or save an item to this shelf from the deck or mod view.'
                : 'Ask a curator to add something, or save an item to this shelf from the deck or mod view.'}
            </p>
          </div>
        ) : (
          <DndContext
            sensors={sensors}
            collisionDetection={closestCorners}
            measuring={{ droppable: { strategy: MeasuringStrategy.Always } }}
            onDragStart={handleDragStart}
            onDragOver={handleDragOver}
            onDragEnd={handleDragEnd}
            onDragCancel={endDrag}
          >
            <SortableContext items={blockIds} strategy={verticalListSortingStrategy}>
              {blocks.map((b) => {
                if (b.segment === null) {
                  const hasSegments = segments.length > 0;
                  const blockItems = containerItems('ungrouped');
                  return (
                    <ShelfSegmentBlock
                      key="ungrouped"
                      containerId="ungrouped"
                      title={hasSegments ? 'Ungrouped' : null}
                      editable={false}
                      items={blockItems}
                      canCurate={canCurate}
                      deckSegments={deckSegments}
                      draggingSourceContainer={draggingSourceContainer}
                      overContainerId={overContainer}
                      sortable={hasSegments}
                      onRemoveItem={(id) => removeItemMutation.mutate(id)}
                      onSendItem={(id, seg, label) => sendToDeck([id], seg, label)}
                      onNoteCommit={(id, note) => noteMutation.mutate({ id, note })}
                    />
                  );
                }
                const seg = b.segment;
                const blockItems = itemsForSegment(seg.id);
                return (
                  <ShelfSegmentBlock
                    key={seg.id}
                    containerId={seg.id}
                    title={editingSegment?.id === seg.id ? editingSegment.name : seg.name}
                    editable
                    items={blockItems}
                    canCurate={canCurate}
                    deckSegments={deckSegments}
                    draggingSourceContainer={draggingSourceContainer}
                    overContainerId={overContainer}
                    sortable
                    onRemoveItem={(id) => removeItemMutation.mutate(id)}
                    onSendItem={(id, dsId, label) => sendToDeck([id], dsId, label)}
                    onNoteCommit={(id, note) => noteMutation.mutate({ id, note })}
                    onRenameLocal={(v) => renameSegmentLocal(seg.id, v)}
                    onRenameCommit={() => commitSegmentRename(seg.id)}
                    onDelete={() => deleteSegment(seg.id)}
                  />
                );
              })}
            </SortableContext>
            <DragOverlay>
              {activeDragItem ? (
                <div className="card-paper p-3 shadow-lg bg-paper opacity-95 cursor-grabbing w-[320px]">
                  <div className="font-mono text-xs uppercase tracking-widest text-ink/60 mb-1">
                    {activeDragItem.kind.replace('_', ' ')}
                  </div>
                  <div className="font-display text-base font-bold leading-tight line-clamp-2">
                    {activeDragItem.title || activeDragItem.url}
                  </div>
                </div>
              ) : activeDragBlock ? (
                <div className="bg-ink/10 border border-ink/30 shadow-lg px-2 py-1.5 w-[320px] opacity-95 cursor-grabbing font-mono text-xs uppercase tracking-widest font-bold text-ink/70">
                  ⠿ {activeDragBlock.segment ? activeDragBlock.segment.name : 'Ungrouped'}
                </div>
              ) : null}
            </DragOverlay>
          </DndContext>
        )}
      </main>
    </div>
  );
}

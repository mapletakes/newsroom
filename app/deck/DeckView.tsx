'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import type { Submission } from '@/components/SubmissionCard';
import { extractYouTubeId, formatDuration, formatDate, kindTint, kindCategory, type KindCategory } from '@/lib/url';
import { positionsFromOrder, insertAtIndex, isSameOrder } from '@/lib/reorder';
import { ArchiveButton } from '@/components/ArchiveButton';
import { QuickLinksDrawer } from './QuickLinksDrawer';
import { ChatStatusBanner } from './ChatStatusBanner';
import { GettingStarted } from './GettingStarted';
import { AppHeader } from '@/components/AppHeader';
import { Button, buttonVariants } from '@/components/ui/button';
import { Input, Textarea } from '@/components/ui/input';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { SimpleTooltip } from '@/components/ui/tooltip';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { useConfirm } from '@/components/ui/confirm-dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { toast } from 'sonner';
import { useQueueRealtime } from '@/lib/use-queue-realtime';
import { useVisiblePoll } from '@/lib/use-visible-poll';
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
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

type Segment = { id: string; name: string; position: number; collapsed: boolean };

// Order within a group: by position (nulls last), then newest first.
const byPosition = (a: Submission, b: Submission) =>
  (a.position ?? 1e9) - (b.position ?? 1e9) ||
  new Date(b.created_at).getTime() - new Date(a.created_at).getTime();


function SortableQueueItem({
  s,
  isActive,
  selected,
  onSelect,
  onRemove,
  onToggleSelect,
}: {
  s: Submission;
  isActive: boolean;
  selected: boolean;
  onSelect: () => void;
  onRemove: () => void;
  onToggleSelect: (shiftKey: boolean) => void;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: s.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0 : 1,
  };

  return (
    <div ref={setNodeRef} style={style}>
      <div className={`flex items-stretch gap-0 ${selected ? 'bg-ink/5' : ''}`}>
        {/* The whole card is the drag source. Plain click activates (and clears
            the multi-selection); Ctrl/Cmd-click toggles this card in the
            selection; Shift-click extends a range. dnd-kit suppresses the click
            after a real drag, so reordering never changes now-playing. */}
        <Card
          asChild
          className={cn(
            kindTint(s.kind),
            isActive ? 'ring-2 ring-rust ring-inset' : selected ? 'ring-2 ring-rust/40 ring-inset' : '',
          )}
        >
          <button
            {...attributes}
            {...listeners}
            onClick={(e) => {
              if (e.shiftKey) onToggleSelect(true);
              else if (e.metaKey || e.ctrlKey) onToggleSelect(false);
              else onSelect();
            }}
            className="flex-1 text-left p-3 min-w-0 cursor-grab active:cursor-grabbing"
          >
          <div className="flex gap-3">
            {s.thumbnail_url && (
              <img
                src={s.thumbnail_url}
                alt=""
                loading="lazy"
                className="shrink-0 w-28 h-[4.5rem] object-cover border border-ink/20"
              />
            )}
            <div className="min-w-0 flex-1">
              <div className="font-mono text-[11px] uppercase tracking-widest text-ink/60 mb-1">
                {isActive && <span className="text-rust font-bold mr-1">▶ NOW</span>}
                {s.kind.replace('_', ' ')}
                {s.duration_seconds ? ` · ${formatDuration(s.duration_seconds)}` : ''}
                {s.published_at ? ` · ${formatDate(s.published_at)}` : ''}
                {s.dmca_risk === 'high' && <span className="text-rust ml-1">⚠</span>}
                {s.content_warning && (
                  <SimpleTooltip content={s.content_warning}>
                    <span className="text-rust font-bold ml-1 cursor-default">⚠ CW</span>
                  </SimpleTooltip>
                )}
              </div>
              <div className="font-display text-lg font-bold leading-tight line-clamp-2">
                {s.title || s.url}
              </div>
              {(s.publisher || s.author) && (
                <div className="font-mono text-xs text-ink/50 truncate mt-0.5">
                  {[s.publisher, s.author].filter(Boolean).join(' · ')}
                </div>
              )}
              {(s.summary || s.description) && (
                <p className="text-sm text-ink/70 leading-snug line-clamp-2 mt-1">
                  {s.summary || s.description}
                </p>
              )}
            </div>
          </div>
          </button>
        </Card>
        <button
          onClick={(e) => { e.stopPropagation(); onRemove(); }}
          className="shrink-0 w-6 flex items-center justify-center text-ink/20 hover:text-rust transition-colors"
          aria-label="Remove"
          tabIndex={-1}
        >
          <span className="material-icons text-base">delete</span>
        </button>
      </div>
    </div>
  );
}

function SegmentBlock({
  containerId,
  title,
  editable,
  collapsed,
  items,
  filtering,
  activeId,
  draggingSourceContainer,
  overContainerId,
  sortable,
  selectedIds,
  onSelectItem,
  onRemoveItem,
  onToggleSelect,
  onRenameLocal,
  onRenameCommit,
  onToggleCollapse,
  onDelete,
  onClearItems,
}: {
  containerId: string; // 'ungrouped' or a segment id — the drop target id
  title: string | null; // null → no header (render items flat)
  editable: boolean;
  collapsed: boolean;
  items: Submission[];
  filtering: boolean; // a type filter is active (suppresses the empty hint)
  activeId: string | null;
  draggingSourceContainer: string | null; // container of the item being dragged, if any
  overContainerId: string | null; // container currently under the cursor
  sortable: boolean; // whether this block can be drag-reordered (has a header)
  selectedIds: Set<string>;
  onSelectItem: (id: string) => void;
  onRemoveItem: (id: string) => void;
  onToggleSelect: (id: string, shiftKey: boolean) => void;
  onRenameLocal?: (name: string) => void;
  onRenameCommit?: () => void;
  onToggleCollapse?: () => void;
  onDelete?: () => void;
  onClearItems?: () => void;
}) {
  // The block is a sortable: draggable by its header grip to reorder blocks,
  // and a drop target so items can be dragged into it (even when collapsed).
  const {
    setNodeRef,
    attributes,
    listeners,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: containerId });

  // True when an item from a DIFFERENT block is hovering this one (anywhere —
  // header, items, or gaps), i.e. a drop here would move it in at the bottom.
  // Driven by the context-level over-container so it works even when the
  // cursor is over an individual item rather than the container itself.
  const isDropTarget =
    overContainerId === containerId &&
    draggingSourceContainer !== null &&
    draggingSourceContainer !== containerId;

  // Combined runtime of any videos in this block.
  const totalSeconds = items.reduce((sum, s) => sum + (s.duration_seconds || 0), 0);

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`mb-2 rounded-sm transition-colors ${
        isDropTarget ? 'ring-2 ring-rust bg-rust/5' : ''
      }`}
    >
      {title !== null && (
        <div className="flex items-center gap-1 mb-1 bg-ink/10 px-1 py-1">
          {sortable && (
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
            onClick={onToggleCollapse}
            className="shrink-0 w-5 text-ink/60 hover:text-ink"
            aria-label={collapsed ? 'Expand' : 'Collapse'}
          >
            {collapsed ? '▸' : '▾'}
          </button>
          {editable ? (
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
          <span className="mr-auto shrink-0 font-mono text-xs font-semibold text-ink/60">
            ({items.length}{totalSeconds > 0 ? ` · ${formatDuration(totalSeconds)}` : ''})
          </span>
          {onClearItems && items.length > 0 && (
            <SimpleTooltip content="Reject all items here (clears the block)">
              <button
                onClick={onClearItems}
                className="shrink-0 w-5 flex items-center justify-center text-ink/30 hover:text-rust"
                aria-label="Reject all items in this block"
              >
                <span className="material-icons text-sm">playlist_remove</span>
              </button>
            </SimpleTooltip>
          )}
          {onDelete && (
            <button onClick={onDelete} className="shrink-0 w-5 flex items-center justify-center text-ink/30 hover:text-rust" aria-label="Delete segment">
              <span className="material-icons text-sm">delete</span>
            </button>
          )}
        </div>
      )}
      {!collapsed ? (
        <SortableContext items={items.map((i) => i.id)} strategy={verticalListSortingStrategy}>
          <div className="space-y-1 min-h-[2rem]">
            {items.map((s) => (
              <SortableQueueItem
                key={s.id}
                s={s}
                isActive={s.id === activeId}
                selected={selectedIds.has(s.id)}
                onSelect={() => onSelectItem(s.id)}
                onRemove={() => onRemoveItem(s.id)}
                onToggleSelect={(shiftKey) => onToggleSelect(s.id, shiftKey)}
              />
            ))}
            {isDropTarget && items.length === 0 && (
              <div className="border-2 border-dashed border-rust bg-rust/10 px-2 py-2 text-center font-mono text-[10px] uppercase tracking-widest text-rust">
                Drop here
              </div>
            )}
            {title !== null && items.length === 0 && !isDropTarget && !filtering && (
              <div className="font-mono text-[10px] text-ink/40 px-6 py-2 italic">
                empty — drag items here
              </div>
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

export function DeckView({
  displayName,
  streamId,
  isAdmin = false,
  curateOnly = false,
}: {
  displayName: string;
  streamId: string;
  isAdmin?: boolean;
  curateOnly?: boolean;
}) {
  const [queue, setQueue] = useState<Submission[]>([]);
  const [segments, setSegments] = useState<Segment[]>([]);
  // True once the first fetch resolves — distinguishes "still loading" from
  // "genuinely empty" so the deck doesn't flash a false empty state on load.
  const [loaded, setLoaded] = useState(false);
  const [ungroupedPosition, setUngroupedPosition] = useState(0);
  const [ungroupedCollapsed, setUngroupedCollapsed] = useState(false);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [takeaway, setTakeaway] = useState('');
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [activeDragId, setActiveDragId] = useState<string | null>(null);
  const [overContainer, setOverContainer] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  // Explicit display order set at drag end so SortableContext.items reflects the new
  // arrangement in the same render that clears transforms — prevents the snap-back flash.
  const [pendingOrder, setPendingOrder] = useState<Record<string, string[]> | null>(null);
  const lastSelectedRef = useRef<string | null>(null);
  // The items the current drag is carrying (the whole selection, or just one).
  const movingIdsRef = useRef<string[]>([]);

  const { confirm, confirmDialog } = useConfirm();

  const [addUrl, setAddUrl] = useState('');
  const [adding, setAdding] = useState(false);
  const announcingRef = useRef(false);

  const suppressRefreshUntil = useRef(0);
  // The segment whose name is being edited, so a refresh doesn't clobber it.
  const editingSegmentRef = useRef<string | null>(null);
  // Whether we've adopted the server's now-playing item into activeId yet.
  // Without this, every fresh tab/reload starts with activeId=null, the
  // "auto-select first item" fallback below picks orderedQueue[0], and the
  // now-playing effect immediately reports THAT as on-air — silently
  // clobbering whatever was actually live (the bug behind the overlay/mod
  // view flashing back to the wrong story whenever a tab is opened/refreshed).
  const seededActiveRef = useRef(false);
  // Tracks the last activeId we told the server about, so re-adopting the
  // server's own value on load doesn't re-POST (and re-broadcast) it right back.
  const lastSentNowPlaying = useRef<string | null>(null);

  const refresh = useCallback(async () => {
    if (Date.now() < suppressRefreshUntil.current) return;
    const [qr, sr] = await Promise.all([
      fetch('/api/queue?status=approved'),
      fetch('/api/segments'),
    ]);
    // Re-check: an edit (e.g. toggling a segment's collapsed state) may have
    // started its own suppression window WHILE these fetches were in flight,
    // which means this response now predates that edit. Applying it would
    // clobber the fresh optimistic state with stale data — the item-order
    // case is shielded from this by pendingOrder, but segment fields
    // (collapsed, position) aren't, which is why toggling collapse could
    // flash back to the old state before correcting itself. Discard; the
    // edit's own reconcileAfterWrites will do the real refresh once it settles.
    if (Date.now() < suppressRefreshUntil.current) return;
    if (qr.ok) {
      const data = await qr.json();
      setQueue(data.submissions || []);
      setPendingOrder(null); // server state is now authoritative
      // Adopt whatever the server already has on air, once, instead of
      // letting the "auto-select first item" effect default to
      // orderedQueue[0] and immediately report that as now-playing.
      if (!seededActiveRef.current) {
        seededActiveRef.current = true;
        const npId: string | null = data.nowPlaying?.id ?? null;
        if (npId) {
          setActiveId(npId);
          setStartedAt(Date.now());
          lastSentNowPlaying.current = npId; // already on the server; skip the redundant re-POST
        }
      }
    }
    if (sr.ok) {
      const data = await sr.json();
      const incoming: Segment[] = data.segments || [];
      // Don't overwrite the name of a segment that's currently being renamed.
      setSegments((prev) => {
        const editing = editingSegmentRef.current;
        if (!editing) return incoming;
        const localName = prev.find((s) => s.id === editing)?.name;
        return localName == null
          ? incoming
          : incoming.map((s) => (s.id === editing ? { ...s, name: localName } : s));
      });
      if (typeof data.ungroupedPosition === 'number') setUngroupedPosition(data.ungroupedPosition);
    }
    setLoaded(true);
  }, []);

  // While the user is actively editing, hold off the realtime + poll refetches
  // so optimistic updates aren't clobbered, then reconcile with the server once
  // all in-flight writes resolve. Reconciling AFTER the writes (rather than on a
  // fixed timer) means the refetch never reads pre-write state — that stale read
  // was the cause of items flashing back in/out on played/remove/reorder.
  const reconcileTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inflightWrites = useRef(0);
  const reconcileAfterWrites = useCallback(<T,>(p: Promise<T>): Promise<T> => {
    inflightWrites.current += 1;
    suppressRefreshUntil.current = Date.now() + 15000; // pause refetches while writing
    const settle = () => {
      inflightWrites.current -= 1;
      if (inflightWrites.current > 0) return; // more writes pending; wait for them
      if (reconcileTimer.current) clearTimeout(reconcileTimer.current);
      reconcileTimer.current = setTimeout(() => {
        if (inflightWrites.current > 0) return; // a new write started; it will reconcile
        suppressRefreshUntil.current = 0;
        refresh();
      }, 250);
    };
    p.then(settle, settle);
    return p;
  }, [refresh]);

  useEffect(() => () => { if (reconcileTimer.current) clearTimeout(reconcileTimer.current); }, []);

  useEffect(() => { refresh(); }, [refresh]);

  // Refetch instantly when the server broadcasts a queue change.
  useQueueRealtime(streamId, refresh);

  // Slow fallback poll in case a broadcast is missed or the socket drops.
  // Only ticks while the tab is visible; realtime is the primary path.
  useVisiblePoll(refresh, 120000);

  // Ordered list of blocks (ungrouped + segments), sorted by position.
  // The ungrouped block participates via a sentinel id so segments can sit
  // above or below it.
  const blocks = useMemo(() => {
    const arr: { id: string; segment: Segment | null; position: number }[] = [
      { id: 'ungrouped', segment: null, position: ungroupedPosition },
      ...segments.map((s) => ({ id: s.id, segment: s, position: s.position })),
    ];
    arr.sort((a, b) => a.position - b.position);
    return arr;
  }, [segments, ungroupedPosition]);

  const blockIds = useMemo(() => blocks.map((b) => b.id), [blocks]);

  // Flattened play order follows the block order.
  const orderedQueue = useMemo(() => {
    const known = new Set(segments.map((s) => s.id));
    const flat: Submission[] = [];
    for (const b of blocks) {
      if (b.segment === null) {
        flat.push(
          ...queue
            .filter((s) => !s.segment_id || !known.has(s.segment_id))
            .sort(byPosition),
        );
      } else {
        flat.push(...queue.filter((s) => s.segment_id === b.segment!.id).sort(byPosition));
      }
    }
    return flat;
  }, [blocks, queue, segments]);

  // Auto-select the first item in play order when nothing is active, or when
  // the active item has left the queue (played/removed from elsewhere).
  useEffect(() => {
    const activeExists = !!activeId && orderedQueue.some((s) => s.id === activeId);
    if (!activeExists && orderedQueue.length > 0) {
      setActiveId(orderedQueue[0].id);
      setStartedAt(Date.now());
      setTakeaway('');
    }
  }, [orderedQueue, activeId]);

  // Drop any selected ids that have left the queue (played/removed/reassigned).
  useEffect(() => {
    setSelectedIds((prev) => {
      if (prev.size === 0) return prev;
      const live = new Set(orderedQueue.map((s) => s.id));
      let changed = false;
      const next = new Set<string>();
      prev.forEach((id) => (live.has(id) ? next.add(id) : (changed = true)));
      return changed ? next : prev;
    });
  }, [orderedQueue]);

  // Report the now-playing item to the server so the mod view can show it.
  // Curators don't drive the live show, so they never set "on air".
  useEffect(() => {
    if (curateOnly) return;
    if (lastSentNowPlaying.current === activeId) return;
    lastSentNowPlaying.current = activeId;
    fetch('/api/deck/now-playing', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: activeId }),
    }).catch(() => {});
  }, [activeId, curateOnly]);

  const active = useMemo(() => {
    const found = queue.find((s) => s.id === activeId) || null;
    if (found && found.related_coverage && !Array.isArray(found.related_coverage)) {
      try {
        found.related_coverage = JSON.parse(found.related_coverage as unknown as string);
      } catch {
        found.related_coverage = null;
      }
    }
    return found;
  }, [queue, activeId]);

  // The item to advance to after playing/skipping/removing the active one:
  // the next item in play order, or the previous one if it was last.
  const nextAfterActive = useCallback((): Submission | null => {
    const idx = orderedQueue.findIndex((s) => s.id === activeId);
    if (idx < 0) return orderedQueue[0] || null;
    return orderedQueue[idx + 1] || orderedQueue[idx - 1] || null;
  }, [orderedQueue, activeId]);

  // The sidebar renders the FULL list (active item included, highlighted),
  // grouped by block.
  const knownSegmentIds = useMemo(() => new Set(segments.map((s) => s.id)), [segments]);
  const ungroupedItems = useMemo(
    () => orderedQueue.filter((s) => !s.segment_id || !knownSegmentIds.has(s.segment_id)),
    [orderedQueue, knownSegmentIds],
  );
  const itemsForSegment = useCallback(
    (segId: string) => orderedQueue.filter((s) => s.segment_id === segId),
    [orderedQueue],
  );

  // Quick view filter by media category. Purely visual — does not affect play
  // order, keyboard nav, or reorder (those use the unfiltered lists above).
  const [typeFilter, setTypeFilter] = useState<'all' | KindCategory>('all');
  const filterItems = useCallback(
    (items: Submission[]) =>
      typeFilter === 'all' ? items : items.filter((s) => kindCategory(s.kind) === typeFilter),
    [typeFilter],
  );
  const catCounts = useMemo(() => {
    const c = { all: orderedQueue.length, video: 0, social: 0, article: 0, other: 0 };
    for (const s of orderedQueue) c[kindCategory(s.kind)]++;
    return c;
  }, [orderedQueue]);

  // How many of the selected items are still in the deck (selection can hold
  // stale ids briefly before the prune effect runs).
  const selectedCount = useMemo(
    () => orderedQueue.reduce((n, s) => (selectedIds.has(s.id) ? n + 1 : n), 0),
    [orderedQueue, selectedIds],
  );

  // Toggle one item in the multi-select; shift-click extends a range over the
  // current play order from the last-clicked item.
  const toggleSelect = (id: string, shiftKey: boolean) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      const order = orderedQueue.map((s) => s.id);
      const anchor = lastSelectedRef.current;
      if (shiftKey && anchor) {
        const a = order.indexOf(anchor);
        const b = order.indexOf(id);
        if (a >= 0 && b >= 0) {
          const [lo, hi] = a < b ? [a, b] : [b, a];
          for (let i = lo; i <= hi; i++) next.add(order[i]);
          lastSelectedRef.current = id;
          return next;
        }
      }
      if (next.has(id)) next.delete(id);
      else next.add(id);
      lastSelectedRef.current = id;
      return next;
    });
  };

  const clearSelection = () => {
    setSelectedIds(new Set());
    lastSelectedRef.current = null;
  };

  // Block ids that actually render under the current filter (so the block-level
  // SortableContext doesn't reference hidden blocks).
  const visibleBlockIds = useMemo(() => {
    if (typeFilter === 'all') return blockIds;
    return blocks
      .filter((b) =>
        b.segment === null
          ? segments.length === 0 || filterItems(ungroupedItems).length > 0
          : filterItems(itemsForSegment(b.segment.id)).length > 0,
      )
      .map((b) => b.id);
  }, [typeFilter, blockIds, blocks, segments, ungroupedItems, filterItems, itemsForSegment]);

  const selectItem = (id: string) => {
    if (id === activeId) return; // already playing — don't reset the timer/takeaway
    setActiveId(id);
    setStartedAt(Date.now());
    setTakeaway('');
  };

  // Plain (unmodified) click on a card: activate it and drop any multi-selection.
  const activateItem = (id: string) => {
    clearSelection();
    selectItem(id);
  };

  const markPlayed = async () => {
    if (!active) return;
    const playedId = active.id;
    const duration = startedAt ? Math.round((Date.now() - startedAt) / 1000) : null;
    const tk = takeaway || null;
    const next = nextAfterActive();
    setActiveId(next?.id || null);
    setStartedAt(next ? Date.now() : null);
    setTakeaway('');
    setQueue((prev) => prev.filter((s) => s.id !== playedId)); // optimistic
    await reconcileAfterWrites(fetch('/api/queue', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: playedId,
        status: 'played',
        takeaway: tk,
        duration_on_screen_s: duration,
      }),
    }));
  };

  const skip = async () => {
    if (!active) return;
    const next = nextAfterActive();
    setActiveId(next?.id || null);
    setStartedAt(next ? Date.now() : null);
    setTakeaway('');
  };

  // Removes instantly, but the actual reject write is delayed 5s behind an
  // Undo toast — during a live show this is faster than a confirm dialog and
  // makes the Del-key shortcut harmless if it's hit by accident.
  const removeFromQueue = (id: string) => {
    const removed = queue.find((s) => s.id === id);
    if (!removed) return;
    setQueue((prev) => prev.filter((s) => s.id !== id));

    let undone = false;
    const timer = setTimeout(() => {
      if (undone) return;
      reconcileAfterWrites(fetch('/api/queue', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, status: 'rejected' }),
      }));
    }, 5000);

    toast('Removed from deck', {
      duration: 5000,
      action: {
        label: 'Undo',
        onClick: () => {
          undone = true;
          clearTimeout(timer);
          setQueue((prev) => [removed, ...prev]);
        },
      },
    });
  };

  // Remove the active item entirely (without marking it played) and advance.
  const rejectActive = () => {
    if (!active) return;
    const removedId = active.id;
    const next = nextAfterActive();
    setActiveId(next?.id || null);
    setStartedAt(next ? Date.now() : null);
    setTakeaway('');
    removeFromQueue(removedId);
  };

  // Keyboard controls: ↑/↓ move the selection, Delete/Backspace trash it.
  // Held in a ref so the single listener always sees the latest state.
  const keyHandlerRef = useRef<(e: KeyboardEvent) => void>(() => {});
  keyHandlerRef.current = (e: KeyboardEvent) => {
    // Don't hijack typing in inputs / textareas / contenteditable fields.
    const el = e.target as HTMLElement | null;
    const tag = el?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || el?.isContentEditable) return;

    // Escape clears a multi-selection.
    if (e.key === 'Escape' && selectedIds.size > 0) {
      e.preventDefault();
      clearSelection();
      return;
    }
    if (orderedQueue.length === 0) return;

    const withMod = e.ctrlKey || e.metaKey;

    // Ctrl/Cmd + ↑/↓ moves the selected item within its block.
    const nudge = (dir: -1 | 1) => {
      if (!active) return;
      const block = containerOf(active.id);
      const groupItems = containerItems(block);
      const i = groupItems.findIndex((s) => s.id === active.id);
      const j = i + dir;
      if (i < 0 || j < 0 || j >= groupItems.length) return;
      persistGroupOrder(arrayMove(groupItems, i, j));
    };

    const idx = orderedQueue.findIndex((s) => s.id === activeId);
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (withMod) { nudge(1); return; }
      const next = orderedQueue[Math.min((idx < 0 ? -1 : idx) + 1, orderedQueue.length - 1)];
      if (next) selectItem(next.id);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (withMod) { nudge(-1); return; }
      const prev = orderedQueue[Math.max((idx < 0 ? 1 : idx) - 1, 0)];
      if (prev) selectItem(prev.id);
    } else if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault();
      rejectActive();
    } else if (e.key === 'Enter') {
      if (active) {
        e.preventDefault();
        window.open(active.url, '_blank', 'noopener,noreferrer');
      }
    } else if (!curateOnly && !withMod && (e.key === 'p' || e.key === 'P')) {
      e.preventDefault();
      markPlayed();
    }
  };
  useEffect(() => {
    const h = (e: KeyboardEvent) => keyHandlerRef.current(e);
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, []);

  // Post "Watching: <title> <url>" to the streamer's chat for pinning.
  const announce = async () => {
    if (!active || announcingRef.current) return;
    announcingRef.current = true;
    const id = toast.loading('Posting to chat…');
    try {
      const r = await fetch('/api/deck/announce', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: active.id }),
      });
      if (r.ok) {
        toast.success('Posted to chat', { id });
      } else {
        const e = await r.json().catch(() => ({}));
        toast.error(e.detail || e.error || 'Failed to post', { id });
      }
    } catch {
      toast.error('Failed to post', { id });
    } finally {
      announcingRef.current = false;
    }
  };

  // --- Segment handlers ---
  const addSegment = async () => {
    await fetch('/api/segments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'New segment' }),
    });
    refresh();
  };

  const renameSegmentLocal = (id: string, name: string) => {
    editingSegmentRef.current = id;
    setSegments((prev) => prev.map((s) => (s.id === id ? { ...s, name } : s)));
  };

  const commitRename = async (id: string) => {
    const seg = segments.find((s) => s.id === id);
    editingSegmentRef.current = null;
    if (!seg) return;
    await reconcileAfterWrites(fetch('/api/segments', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, name: seg.name }),
    }));
  };

  const toggleCollapse = async (seg: Segment) => {
    const collapsed = !seg.collapsed;
    setSegments((prev) => prev.map((s) => (s.id === seg.id ? { ...s, collapsed } : s)));
    await reconcileAfterWrites(fetch('/api/segments', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: seg.id, collapsed }),
    }));
  };

  // Persist a new block order (ungrouped + segments) after a drag.
  const persistBlockOrder = (orderedIds: string[]) => {
    // Optimistic: assign positions 1..N across all blocks.
    const pos = positionsFromOrder(orderedIds);
    setSegments((prev) => prev.map((s) => ({ ...s, position: pos.get(s.id) ?? s.position })));
    if (pos.has('ungrouped')) setUngroupedPosition(pos.get('ungrouped')!);

    return reconcileAfterWrites(fetch('/api/segments/reorder', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids: orderedIds }),
    }));
  };

  const deleteSegment = async (id: string) => {
    if (!(await confirm({
      title: 'Delete this segment?',
      description: 'Its items move back to Ungrouped.',
      confirmText: 'Delete',
      destructive: true,
    }))) return;
    await fetch('/api/segments', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id }),
    });
    refresh();
  };

  // Reject every item in one block (a segment, or ungrouped) — end-of-day cleanup.
  const clearBlock = async (containerId: string, label: string) => {
    const inBlock = (s: Submission) =>
      containerId === 'ungrouped'
        ? !s.segment_id || !knownSegmentIds.has(s.segment_id)
        : s.segment_id === containerId;
    const count = queue.filter(inBlock).length;
    if (count === 0) return;
    if (!(await confirm({
      title: `Reject all ${count} item${count === 1 ? '' : 's'} in ${label}?`,
      description: 'They’ll be removed from the deck.',
      confirmText: 'Reject all',
      destructive: true,
    }))) return;
    // Optimistic: drop them from the deck immediately.
    setQueue((prev) => prev.filter((s) => !inBlock(s)));
    await reconcileAfterWrites(fetch('/api/deck/clear-block', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ containerId }),
    }));
  };

  // Move one or more items into a block and set that block's full order. Used
  // for single drags, multi-select drags, and the "Move to…" picker.
  const moveItems = (movingIds: string[], segmentId: string | null, orderedTargetIds: string[]) => {
    const posMap = positionsFromOrder(orderedTargetIds);
    const movingSet = new Set(movingIds);
    setQueue((prev) =>
      prev.map((s) => {
        const inMoving = movingSet.has(s.id);
        const pos = posMap.get(s.id);
        if (!inMoving && pos === undefined) return s;
        return { ...s, segment_id: inMoving ? segmentId : s.segment_id, position: pos ?? s.position };
      }),
    );
    return reconcileAfterWrites(fetch('/api/queue/move', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids: movingIds, segmentId, orderedIds: orderedTargetIds }),
    }));
  };

  // Move the current selection to the bottom of a chosen block (the "Move to…"
  // picker); drag handles precise placement like the top of a segment.
  const moveSelectedTo = (target: string) => {
    const movingIds = orderedQueue.filter((s) => selectedIds.has(s.id)).map((s) => s.id);
    if (movingIds.length === 0) return;
    const movingSet = new Set(movingIds);
    const remaining = containerItems(target).filter((s) => !movingSet.has(s.id));
    const movingItems = orderedQueue.filter((s) => movingSet.has(s.id));
    const segId = target === 'ungrouped' ? null : target;
    moveItems(movingIds, segId, [...remaining, ...movingItems].map((s) => s.id));
    clearSelection();
  };

  // Persist a new within-group order (positions 1..N).
  const persistGroupOrder = (reordered: Submission[]) => {
    setQueue((prev) => {
      const pos = positionsFromOrder(reordered.map((s) => s.id));
      return prev.map((s) => (pos.has(s.id) ? { ...s, position: pos.get(s.id)! } : s));
    });
    return reconcileAfterWrites(fetch('/api/queue/reorder', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids: reordered.map((s) => s.id) }),
    }));
  };

  // Which block holds a given item id ('ungrouped' or a segment id).
  const containerOf = useCallback(
    (itemId: string): string => {
      const item = queue.find((s) => s.id === itemId);
      if (item?.segment_id && knownSegmentIds.has(item.segment_id)) return item.segment_id;
      return 'ungrouped';
    },
    [queue, knownSegmentIds],
  );

  const containerItems = useCallback(
    (containerId: string): Submission[] => {
      const base = containerId === 'ungrouped' ? ungroupedItems : itemsForSegment(containerId);
      const order = pendingOrder?.[containerId];
      if (!order) return base;
      const map = new Map(base.map((s) => [s.id, s]));
      return order.map((id) => map.get(id)).filter((s): s is Submission => s !== undefined);
    },
    [ungroupedItems, itemsForSegment, pendingOrder],
  );

  const handleDragStart = (event: DragStartEvent) => {
    const id = String(event.active.id);
    setActiveDragId(id);
    setPendingOrder(null); // clear stale override so containerItems reads live queue state
    movingIdsRef.current =
      !isBlockId(id) && selectedIds.has(id) && selectedCount > 1
        ? orderedQueue.filter((s) => selectedIds.has(s.id)).map((s) => s.id)
        : [id];
  };

  const isBlockId = useCallback(
    (id: string) => id === 'ungrouped' || knownSegmentIds.has(id),
    [knownSegmentIds],
  );

  const endDrag = () => {
    setActiveDragId(null);
    setOverContainer(null);
    movingIdsRef.current = [];
  };

  const handleDragOver = (event: DragOverEvent) => {
    const { active, over } = event;
    if (isBlockId(String(active.id))) { setOverContainer(null); return; }
    if (!over) { setOverContainer(null); return; }
    const overId = String(over.id);
    setOverContainer(isBlockId(overId) ? overId : containerOf(overId));
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active: dragged, over } = event;
    const grabbed = movingIdsRef.current;

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

    // Item drag — carries the whole multi-selection if the grabbed card was part of it.
    const movingIds = grabbed.length ? grabbed : [draggedId];
    const movingSet = new Set(movingIds);
    const movingItems = orderedQueue.filter((s) => movingSet.has(s.id));

    const sourceContainer = containerOf(draggedId);
    const targetContainer = isBlockId(overId) ? overId : containerOf(overId);
    const targetItems = containerItems(targetContainer);

    // Same-container single item: arrayMove handles direction correctly from indices.
    if (sourceContainer === targetContainer && movingIds.length === 1 && !isBlockId(overId)) {
      const fromIdx = targetItems.findIndex((s) => s.id === draggedId);
      const toIdx = targetItems.findIndex((s) => s.id === overId);
      if (fromIdx >= 0 && toIdx >= 0 && fromIdx !== toIdx) {
        const reordered = arrayMove(targetItems, fromIdx, toIdx);
        // Set display order immediately — same render as endDrag() clears transforms.
        // Merge rather than replace: a rapid second drag on a different
        // container must not wipe out this container's still-unresolved
        // override (that was the "flashes back on quick successive drags"
        // bug — a later setPendingOrder(newOnly) discarded earlier overrides).
        setPendingOrder((prev) => ({ ...prev, [targetContainer]: reordered.map((s) => s.id) }));
        persistGroupOrder(reordered);
      }
      endDrag();
      return;
    }

    // Cross-container or multi-select: insert at over.id's position in remaining.
    const remaining = targetItems.filter((s) => !movingSet.has(s.id));
    const overIdx = isBlockId(overId) ? -1 : remaining.findIndex((s) => s.id === overId);
    const result = insertAtIndex(remaining, movingItems, overIdx);

    // No-op: same-container drag that didn't change order.
    if (sourceContainer === targetContainer && isSameOrder(result, targetItems)) {
      endDrag();
      return;
    }

    // Set display order immediately for both affected containers. Merge into
    // any existing overrides — see the same-container branch above for why a
    // blind replace is wrong when drags happen in quick succession.
    const remainingAtSource = sourceContainer !== targetContainer
      ? containerItems(sourceContainer).filter((s) => !movingSet.has(s.id)).map((s) => s.id)
      : null;
    setPendingOrder((prev) => {
      const next = { ...prev, [targetContainer]: result.map((s) => s.id) };
      if (remainingAtSource) next[sourceContainer] = remainingAtSource;
      return next;
    });

    const segId = targetContainer === 'ungrouped' ? null : targetContainer;
    moveItems(movingIds, segId, result.map((s) => s.id));
    if (movingIds.length > 1) clearSelection();
    endDrag();
  };

  // --- Direct add ---
  const handleAddLink = async (e: React.FormEvent) => {
    e.preventDefault();
    const url = addUrl.trim();
    if (!url || adding) return;
    setAdding(true);
    try {
      const r = await fetch('/api/deck/add', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url }),
      });
      if (r.ok) {
        const data = await r.json();
        setAddUrl('');
        toast.success(data.expanded ? `Added ${data.count} videos from playlist` : 'Added to deck');
        refresh();
      } else {
        const err = await r.json().catch(() => ({}));
        toast.error(err.error || 'Failed to add');
      }
    } finally {
      setAdding(false);
    }
  };

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const embedYouTube =
    active && (active.kind === 'youtube' || active.kind === 'youtube_short')
      ? extractYouTubeId(active.url)
      : null;

  const draggingBlock = activeDragId !== null && isBlockId(activeDragId);
  const activeDragItem = activeDragId && !draggingBlock ? queue.find((s) => s.id === activeDragId) || null : null;
  const activeDragBlock = draggingBlock
    ? blocks.find((b) => b.id === activeDragId) || null
    : null;
  const draggingSourceContainer = activeDragItem ? containerOf(activeDragItem.id) : null;
  // How many cards the current drag is carrying (the whole selection if the
  // grabbed card is part of it).
  const dragCount =
    activeDragItem && selectedIds.has(activeDragItem.id) && selectedCount > 1 ? selectedCount : 1;

  return (
    <div className="min-h-screen flex flex-col">
      {!curateOnly && <QuickLinksDrawer />}
      {confirmDialog}
      <AppHeader
        className="sticky top-0 z-20 bg-paper border-b-2 border-ink pl-10 pr-6 py-3 gap-6"
        section={curateOnly ? 'curating deck' : 'streamer deck'}
        right={
          <>
            <span className="uppercase tracking-widest">{queue.length} approved</span>
            <Link href="/mod" className="underline hover:text-rust">
              Mod View &rarr;
            </Link>
            {!curateOnly && (
              <a href="/api/notes?format=markdown&commit=1" className="underline hover:text-rust">
                Export Notes
              </a>
            )}
            {!curateOnly && (
              <Link href="/setup" className="underline hover:text-rust">
                Settings
              </Link>
            )}
            {isAdmin && (
              <Link href="/admin" className="underline hover:text-rust">
                Admin
              </Link>
            )}
            <span>{displayName}</span>
          </>
        }
      />
      {!curateOnly && <ChatStatusBanner />}

      <main className="flex-1 grid lg:grid-cols-2 gap-0 pl-3">
        {/* Active card */}
        <section className="p-8 border-r border-ink/20">
          {!loaded ? (
            <div>
              <div className="flex gap-2 mb-4">
                <Skeleton className="h-6 w-24" />
                <Skeleton className="h-6 w-20" />
              </div>
              <Skeleton className="h-9 w-full mb-2" />
              <Skeleton className="h-9 w-2/3 mb-6" />
              <Skeleton className="h-4 w-full mb-2" />
              <Skeleton className="h-4 w-full mb-2" />
              <Skeleton className="h-4 w-3/4" />
            </div>
          ) : !active ? (
            <div className="text-center py-24">
              <p className="font-display text-3xl mb-3">No approved items yet.</p>
              <p className="text-ink/60 font-mono text-sm mb-6">
                Your mods need to approve submissions in the
                <Link href="/mod" className="underline ml-1">
                  Mod View
                </Link>
                , or add links directly from the sidebar.
              </p>
            </div>
          ) : null}
          {active && (
            <article>
              <div className="flex items-center gap-2 mb-3 flex-wrap font-mono text-xs uppercase tracking-widest">
                <Badge size="default">{active.kind.replace('_', ' ')}</Badge>
                {active.duration_seconds ? (
                  <Badge variant="outlineStrong" size="default">{formatDuration(active.duration_seconds)}</Badge>
                ) : null}
                {active.credibility_tag && (
                  <Badge variant="outlineStrong" size="default">{active.credibility_tag}</Badge>
                )}
                {active.dmca_risk === 'high' && (
                  <Badge variant="destructive" size="default">⚠ High DMCA risk</Badge>
                )}
                {active.dmca_risk === 'medium' && (
                  <Badge variant="warning" size="default">◐ Medium risk</Badge>
                )}
                {active.content_warning && (
                  <SimpleTooltip content={active.content_warning}>
                    <Badge variant="destructive" size="default" className="cursor-default">
                      ⚠ Content warning
                    </Badge>
                  </SimpleTooltip>
                )}
                {active.publisher && <span className="text-ink/60">· {active.publisher}</span>}
                {active.published_at && <span className="text-ink/60">· {formatDate(active.published_at)}</span>}
                <span className="ml-auto normal-case tracking-normal">
                  <ArchiveButton id={active.id} url={active.url} archiveUrl={active.archive_url} />
                </span>
              </div>

              <h1 className="font-display text-3xl lg:text-4xl font-black leading-tight mb-4">
                {active.title || active.url}
              </h1>

              {(active.summary || active.description) && (
                <p className="text-lg leading-relaxed mb-6 max-w-3xl whitespace-pre-line">
                  {active.summary || active.description}
                </p>
              )}

              {active.mod_notes && (
                <div className="max-w-3xl mb-6 border-l-4 border-ochre bg-ochre/10 px-4 py-3">
                  <span className="font-mono text-xs uppercase tracking-widest text-ochre block mb-1">
                    Mod note
                  </span>
                  <span className="text-sm">{active.mod_notes}</span>
                </div>
              )}

              {embedYouTube && (
                <div className="aspect-video bg-ink mb-6 max-w-3xl">
                  <iframe
                    src={`https://www.youtube.com/embed/${embedYouTube}`}
                    className="w-full h-full"
                    allowFullScreen
                    allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                  />
                </div>
              )}

              {active.kind === 'article' && active.thumbnail_url && (
                <img
                  src={active.thumbnail_url}
                  alt=""
                  className="max-w-3xl border border-ink/20 mb-6"
                />
              )}

              {active.topics && active.topics.length > 0 && (
                <div className="flex flex-wrap gap-1 mb-6">
                  {active.topics.map((t) => (
                    <span
                      key={t}
                      className="font-mono text-xs uppercase bg-paper border border-ink/30 px-2 py-1"
                    >
                      #{t}
                    </span>
                  ))}
                </div>
              )}

              {active.related_coverage &&
                Array.isArray(active.related_coverage) &&
                active.related_coverage.length > 0 && (
                  <div className="mb-6 max-w-3xl">
                    <div className="rule-double mb-3" />
                    <h2 className="font-mono text-xs uppercase tracking-widest text-ink/60 mb-3">
                      Related coverage ({active.related_coverage.length})
                    </h2>
                    <div className="space-y-2">
                      {active.related_coverage.map((c, i) => (
                        <a
                          key={i}
                          href={c.url}
                          target="_blank"
                          rel="noreferrer"
                          className="block card-paper p-3 hover:border-ink"
                        >
                          <div className="font-display text-sm font-bold leading-tight mb-1">
                            {c.title}
                          </div>
                          <div className="font-mono text-xs uppercase tracking-widest text-ink/60 mb-1">
                            {c.publisher}
                          </div>
                          {c.snippet && (
                            <div className="text-xs text-ink/70 leading-relaxed line-clamp-2">
                              {c.snippet}
                            </div>
                          )}
                        </a>
                      ))}
                    </div>
                    <div className="rule-double mt-3" />
                  </div>
                )}

              <div className="flex gap-3 flex-wrap mb-6">
                <a href={active.url} target="_blank" rel="noreferrer" className={buttonVariants()}>
                  Open source ↗
                </a>
                {!curateOnly && (
                  <Button variant="moss" onClick={markPlayed}>
                    ✓ Played — next
                  </Button>
                )}
                {!curateOnly && (
                  <Button variant="outline" onClick={skip}>
                    Skip
                  </Button>
                )}
                <Button variant="outlineDestructive" onClick={rejectActive} title="Remove from deck">
                  <span className="material-icons text-base">delete</span>
                  Remove
                </Button>
                {!curateOnly && (
                  <Button
                    variant="outline"
                    onClick={announce}
                    title="Post 'Watching: …' to your chat so a mod can pin it"
                  >
                    <span className="material-icons text-base">campaign</span>
                    Post to chat
                  </Button>
                )}
              </div>

              {!curateOnly && (
                <label className="block max-w-3xl">
                  <span className="font-mono text-xs uppercase tracking-widest text-ink/60">
                    Takeaway for show notes (optional)
                  </span>
                  <Textarea
                    value={takeaway}
                    onChange={(e) => setTakeaway(e.target.value)}
                    rows={3}
                    className="w-full mt-1"
                    placeholder="Add a one-liner about what you said about this on stream..."
                  />
                </label>
              )}
            </article>
          )}
        </section>

        {/* Sidebar */}
        <aside className="p-4 bg-ink/5 flex flex-col">
          {!curateOnly && <GettingStarted />}
          {/* Add link */}
          <form onSubmit={handleAddLink} className="mb-4">
            <div className="flex gap-1">
              <Input
                type="url"
                value={addUrl}
                onChange={(e) => setAddUrl(e.target.value)}
                placeholder="Paste link or playlist URL..."
                className="flex-1 min-w-0 text-xs"
                disabled={adding}
              />
              <Button type="submit" size="sm" disabled={adding || !addUrl.trim()} className="shrink-0">
                {adding ? '...' : 'Add'}
              </Button>
            </div>
          </form>

          <div className="flex items-center gap-3 mb-3 flex-wrap">
            <span className="shrink-0 font-mono text-xs uppercase tracking-widest text-ink/60">
              Queue ({orderedQueue.length})
            </span>
            <span className="min-w-0 truncate font-mono text-[10px] text-ink/40">
              click select · ⇧/⌃-click multi · drag to reorder{!curateOnly && ' · P played'} · Del remove
            </span>
            <Button variant="outline" size="xs" onClick={addSegment} className="shrink-0 ml-auto border-ink/30">
              + Segment
            </Button>
          </div>

          {/* Quick type filter */}
          <ToggleGroup
            type="single"
            value={typeFilter}
            onValueChange={(v) => { if (v) setTypeFilter(v as 'all' | KindCategory); }}
            className="mb-3 pb-1 border-b border-ink/20 text-[10px]"
          >
            {([
              ['all', 'All'],
              ['video', 'Videos'],
              ['social', 'Socials'],
              ['article', 'Articles'],
              ['other', 'Other'],
            ] as const).map(([key, label]) => (
              <ToggleGroupItem key={key} value={key} variant="tab">
                {label} ({catCounts[key]})
              </ToggleGroupItem>
            ))}
          </ToggleGroup>

          {/* Multi-select action bar */}
          {selectedCount > 0 && (
            <div className="flex items-center gap-2 mb-2 px-2 py-1.5 bg-ink text-paper font-mono text-xs uppercase tracking-widest">
              <span className="font-bold">{selectedCount} selected</span>
              <span className="opacity-50 normal-case tracking-normal">— drag to move, or</span>
              <DropdownMenu>
                <DropdownMenuTrigger
                  className="inline-flex items-center gap-1 bg-paper text-ink px-2 py-0.5 hover:bg-rust hover:text-paper transition-colors focus:outline-none"
                  aria-label="Move selected to block"
                >
                  Move to…
                  <span className="material-icons text-sm leading-none">arrow_drop_down</span>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start">
                  <DropdownMenuLabel>Move to</DropdownMenuLabel>
                  <DropdownMenuItem onSelect={() => moveSelectedTo('ungrouped')}>
                    Ungrouped
                  </DropdownMenuItem>
                  {segments.length > 0 && <DropdownMenuSeparator />}
                  {segments.map((s) => (
                    <DropdownMenuItem key={s.id} onSelect={() => moveSelectedTo(s.id)}>
                      {s.name}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
              <button onClick={clearSelection} className="ml-auto underline hover:opacity-70">
                Clear
              </button>
            </div>
          )}

          <div className="flex-1 overflow-y-auto">
            <DndContext
              sensors={sensors}
              collisionDetection={closestCorners}
              measuring={{ droppable: { strategy: MeasuringStrategy.Always } }}
              onDragStart={handleDragStart}
              onDragOver={handleDragOver}
              onDragEnd={handleDragEnd}
              onDragCancel={endDrag}
            >
              <SortableContext items={visibleBlockIds} strategy={verticalListSortingStrategy}>
                {blocks.map((b) => {
                  const filtering = typeFilter !== 'all';
                  if (b.segment === null) {
                    // Ungrouped block. Only gets a header (and drag handle) once
                    // at least one segment exists; otherwise renders flat.
                    const hasSegments = segments.length > 0;
                    const items = filterItems(containerItems('ungrouped'));
                    if (filtering && hasSegments && items.length === 0) return null;
                    return (
                      <SegmentBlock
                        key="ungrouped"
                        containerId="ungrouped"
                        title={hasSegments ? 'Ungrouped' : null}
                        editable={false}
                        collapsed={ungroupedCollapsed}
                        items={items}
                        filtering={filtering}
                        activeId={activeId}
                        draggingSourceContainer={draggingSourceContainer}
                        overContainerId={overContainer}
                        sortable={hasSegments}
                        selectedIds={selectedIds}
                        onSelectItem={activateItem}
                        onRemoveItem={removeFromQueue}
                        onToggleSelect={toggleSelect}
                        onToggleCollapse={hasSegments ? () => setUngroupedCollapsed((c) => !c) : undefined}
                        onClearItems={hasSegments ? () => clearBlock('ungrouped', 'the Ungrouped list') : undefined}
                      />
                    );
                  }
                  const seg = b.segment;
                  const items = filterItems(containerItems(seg.id));
                  // Hide segments with nothing matching the active filter.
                  if (filtering && items.length === 0) return null;
                  return (
                    <SegmentBlock
                      key={seg.id}
                      containerId={seg.id}
                      title={seg.name}
                      editable
                      collapsed={seg.collapsed}
                      items={items}
                      filtering={filtering}
                      activeId={activeId}
                      draggingSourceContainer={draggingSourceContainer}
                      overContainerId={overContainer}
                      sortable
                      selectedIds={selectedIds}
                      onSelectItem={activateItem}
                      onRemoveItem={removeFromQueue}
                      onToggleSelect={toggleSelect}
                      onRenameLocal={(name) => renameSegmentLocal(seg.id, name)}
                      onRenameCommit={() => commitRename(seg.id)}
                      onToggleCollapse={() => toggleCollapse(seg)}
                      onDelete={() => deleteSegment(seg.id)}
                      onClearItems={() => clearBlock(seg.id, `“${seg.name}”`)}
                    />
                  );
                })}
              </SortableContext>
              <DragOverlay>
                {activeDragItem ? (
                  <div className="relative w-[300px]">
                    {dragCount > 1 && (
                      <>
                        <div className="absolute inset-0 translate-x-1.5 translate-y-1.5 card-paper bg-paper" />
                        <div className="absolute inset-0 translate-x-0.5 translate-y-0.5 card-paper bg-paper" />
                      </>
                    )}
                    <div className="relative card-paper p-2 shadow-lg bg-paper opacity-95 cursor-grabbing">
                      <div className="font-mono text-xs uppercase tracking-widest text-ink/60 mb-1">
                        {activeDragItem.kind.replace('_', ' ')}
                        {activeDragItem.duration_seconds ? ` · ${formatDuration(activeDragItem.duration_seconds)}` : ''}
                      </div>
                      <div className="font-display text-base font-bold leading-tight line-clamp-2">
                        {activeDragItem.title || activeDragItem.url}
                      </div>
                    </div>
                    {dragCount > 1 && (
                      <span className="absolute -top-2 -right-2 z-10 min-w-[1.5rem] h-6 px-1.5 flex items-center justify-center rounded-full bg-rust text-paper font-mono text-xs font-bold shadow">
                        {dragCount}
                      </span>
                    )}
                  </div>
                ) : activeDragBlock ? (
                  <div className="bg-ink/10 border border-ink/30 shadow-lg px-2 py-1.5 w-[300px] opacity-95 cursor-grabbing font-mono text-xs uppercase tracking-widest font-bold text-ink/70">
                    ⠿ {activeDragBlock.segment ? activeDragBlock.segment.name : 'Ungrouped'}
                  </div>
                ) : null}
              </DragOverlay>
            </DndContext>
          </div>
        </aside>
      </main>
    </div>
  );
}

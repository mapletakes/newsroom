'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
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
import { useVisiblePoll } from '@/lib/use-visible-poll';
import { cn } from '@/lib/utils';
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

type ListItem = {
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
  created_at: string;
};

type Segment = { id: string; name: string };

// A "Send to deck" button that becomes a dropdown (ungrouped + each segment)
// once the stream has any segments defined — otherwise it's a single click
// straight to ungrouped. Shared by the per-item row and the list-level
// "Send all" action.
function SendToDeckMenu({
  segments,
  onSend,
  label = 'Send to deck',
  size = 'sm',
}: {
  segments: Segment[];
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
  segments,
  onRemove,
  onSend,
  onNoteCommit,
}: {
  item: ListItem;
  canCurate: boolean;
  segments: Segment[];
  onRemove: () => void;
  onSend: (segmentId: string | null, label: string) => void;
  onNoteCommit: (note: string) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: item.id });
  const style = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.4 : 1 };

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
              placeholder="Why this is on the list…"
              className="w-full text-xs mb-2"
              disabled={!canCurate}
            />
          ) : null}
          <div className="flex items-center gap-2 flex-wrap">
            <a href={item.url} target="_blank" rel="noreferrer" className={buttonVariants({ variant: 'outline', size: 'xs' })}>
              Open ↗
            </a>
            {canCurate && <SendToDeckMenu segments={segments} onSend={onSend} size="xs" />}
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
                aria-label="Remove from list"
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

export function ListDetailView({
  listId,
  displayName,
  isAdmin = false,
  isMod = false,
  canCurate = false,
}: {
  listId: string;
  displayName: string;
  isAdmin?: boolean;
  isMod?: boolean;
  canCurate?: boolean;
}) {
  const [list, setList] = useState<{ id: string; name: string; share_token: string | null } | null>(null);
  const [items, setItems] = useState<ListItem[]>([]);
  const [segments, setSegments] = useState<Segment[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [name, setName] = useState('');
  const editingNameRef = useRef(false);
  const [addUrl, setAddUrl] = useState('');
  const [adding, setAdding] = useState(false);
  const { confirm, confirmDialog } = useConfirm();

  const refresh = useCallback(async () => {
    const r = await fetch(`/api/lists/${listId}`);
    if (r.ok) {
      const data = await r.json();
      setList(data.list);
      if (!editingNameRef.current) setName(data.list.name);
      setItems(data.items || []);
    }
    setLoaded(true);
  }, [listId]);

  useEffect(() => { refresh(); }, [refresh]);
  useEffect(() => {
    fetch('/api/segments').then((r) => (r.ok ? r.json() : null)).then((d) => { if (d) setSegments(d.segments || []); });
  }, []);
  // No realtime channel for lists (lower-urgency surface than the live
  // queue) — a slow visible-tab poll is enough to pick up another curator's
  // edits.
  useVisiblePoll(refresh, 30000);

  const commitName = async () => {
    editingNameRef.current = false;
    const trimmed = name.trim();
    if (!trimmed || trimmed === list?.name) {
      if (list) setName(list.name);
      return;
    }
    await fetch(`/api/lists/${listId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: trimmed }),
    });
  };

  const handleAddUrl = async (e: React.FormEvent) => {
    e.preventDefault();
    const url = addUrl.trim();
    if (!url || adding) return;
    setAdding(true);
    try {
      const r = await fetch(`/api/lists/${listId}/items`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url }),
      });
      if (r.ok) {
        const data = await r.json();
        setAddUrl('');
        if (data.added > 0) {
          toast.success('Added to clip file');
          refresh();
        } else {
          toast('Already on this list');
        }
      } else {
        toast.error('Failed to add');
      }
    } finally {
      setAdding(false);
    }
  };

  const removeItem = (id: string) => {
    setItems((prev) => prev.filter((i) => i.id !== id)); // optimistic
    fetch(`/api/lists/${listId}/items/${id}`, { method: 'DELETE' }).catch(() => {});
  };

  const commitNote = (id: string, note: string) => {
    fetch(`/api/lists/${listId}/items/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ note: note || null }),
    }).catch(() => {});
  };

  const sendToDeck = async (itemIds: string[] | null, segmentId: string | null, segLabel: string) => {
    const r = await fetch(`/api/lists/${listId}/send-to-deck`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ itemIds, segmentId }),
    });
    if (!r.ok) { toast.error('Failed to send to deck'); return; }
    const data = await r.json();
    if (data.added > 0) {
      toast.success(`Sent ${data.added} to deck${segLabel ? ` — ${segLabel}` : ''}${data.skipped ? ` (${data.skipped} already there)` : ''}`);
    } else {
      toast(data.skipped ? 'Already on the deck' : 'Nothing to send');
    }
  };

  const [sharing, setSharing] = useState(false);
  const [copied, setCopied] = useState(false);
  const shareUrl = list?.share_token && typeof window !== 'undefined'
    ? `${window.location.origin}/l/${list.share_token}`
    : '';

  const generateShareLink = async () => {
    if (sharing) return;
    setSharing(true);
    try {
      const r = await fetch(`/api/lists/${listId}/share`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      if (r.ok) {
        const data = await r.json();
        setList((prev) => (prev ? { ...prev, share_token: data.token } : prev));
      } else {
        toast.error('Failed to create share link');
      }
    } finally {
      setSharing(false);
    }
  };

  const revokeShareLink = async () => {
    if (!(await confirm({
      title: 'Revoke this share link?',
      description: 'The current link will stop working. You can generate a new one anytime.',
      confirmText: 'Revoke',
      destructive: true,
    }))) return;
    await fetch(`/api/lists/${listId}/share`, { method: 'DELETE' });
    setList((prev) => (prev ? { ...prev, share_token: null } : prev));
  };

  const copyShareLink = async () => {
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch { /* clipboard unavailable */ }
  };

  const deleteList = async () => {
    if (!list) return;
    if (!(await confirm({
      title: `Delete “${list.name}”?`,
      description: `This can't be undone. ${items.length} item${items.length === 1 ? '' : 's'} will be removed with it.`,
      confirmText: 'Delete',
      destructive: true,
    }))) return;
    await fetch(`/api/lists/${listId}`, { method: 'DELETE' });
    window.location.href = '/lists';
  };

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    setItems((prev) => {
      const oldIndex = prev.findIndex((i) => i.id === active.id);
      const newIndex = prev.findIndex((i) => i.id === over.id);
      if (oldIndex < 0 || newIndex < 0) return prev;
      const reordered = arrayMove(prev, oldIndex, newIndex);
      fetch(`/api/lists/${listId}/items/reorder`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: reordered.map((i) => i.id) }),
      }).catch(() => {});
      return reordered;
    });
  };

  return (
    <div className="min-h-screen flex flex-col">
      {confirmDialog}
      <AppHeader
        className="border-b-2 border-ink px-6 py-3 gap-6"
        section={<>clip file</>}
        right={
          <>
            <Link href="/lists" className="underline hover:text-rust">← Clip Files</Link>
            {!isMod && <Link href="/deck" className="underline hover:text-rust">Streamer Deck</Link>}
            <Link href="/mod" className="underline hover:text-rust">Mod View</Link>
            {isAdmin && <Link href="/admin" className="underline hover:text-rust">Admin</Link>}
            <span>{displayName}</span>
          </>
        }
      />

      <main className="px-6 py-8 max-w-3xl mx-auto w-full flex-1">
        {!loaded ? (
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
              <button onClick={deleteList} className="shrink-0 font-mono text-xs uppercase tracking-widest text-ink/40 hover:text-rust">
                Delete clip file
              </button>
            )}
          </div>
        )}

        <div className="flex items-center gap-3 mb-6 flex-wrap">
          <span className="font-mono text-xs uppercase tracking-widest text-ink/60">
            {items.length} item{items.length === 1 ? '' : 's'}
          </span>
          {canCurate && items.length > 0 && (
            <SendToDeckMenu segments={segments} onSend={(seg, label) => sendToDeck(null, seg, label)} label="Send all to deck" />
          )}
        </div>

        {canCurate && (
          <div className="flex items-center gap-2 mb-6 flex-wrap">
            {list?.share_token ? (
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
              <Button variant="outline" size="sm" onClick={generateShareLink} disabled={sharing}>
                {sharing ? '…' : 'Share with another streamer…'}
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
              placeholder="Paste a link to add it to this clip file…"
              className="flex-1"
              disabled={adding}
            />
            <Button type="submit" disabled={adding || !addUrl.trim()}>
              {adding ? '…' : 'Add'}
            </Button>
          </form>
        )}

        {!loaded ? (
          <div className="space-y-3">
            {[0, 1, 2].map((i) => <Skeleton key={i} className="h-32 w-full" />)}
          </div>
        ) : items.length === 0 ? (
          <div className="text-center py-16">
            <p className="font-display text-2xl mb-2">Nothing here yet.</p>
            <p className="text-ink/60 font-mono text-sm">
              {canCurate
                ? 'Paste a link above, or save an item to this clip file from the deck or mod view.'
                : 'Ask a curator to add something, or save an item to this clip file from the deck or mod view.'}
            </p>
          </div>
        ) : (
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
            <SortableContext items={items.map((i) => i.id)} strategy={verticalListSortingStrategy}>
              <div className="space-y-3">
                {items.map((item) => (
                  <SortableItemRow
                    key={item.id}
                    item={item}
                    canCurate={canCurate}
                    segments={segments}
                    onRemove={() => removeItem(item.id)}
                    onSend={(seg, label) => sendToDeck([item.id], seg, label)}
                    onNoteCommit={(note) => commitNote(item.id, note)}
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

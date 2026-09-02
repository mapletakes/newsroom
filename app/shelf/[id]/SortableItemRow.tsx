'use client';

// One shelf item row — mirrors the deck's SortableQueueItem, minus the
// active-item highlighting (a shelf has no "now playing" concept). Owns its
// own local note-editing state (showNote/note); everything else comes in as
// props. Split out of ShelfDetailView.tsx as a structural move only, no
// rendered output changed.

import { useState } from 'react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { buttonVariants } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Icon } from '@/components/ui/icon';
import { SimpleTooltip } from '@/components/ui/tooltip';
import { formatDuration, formatDate, relativeTime, kindTint } from '@/lib/url';
import { cn } from '@/lib/utils';
import { SendToDeckMenu, type DeckSegment } from './SendToDeckMenu';

export type ShelfItem = {
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

export function SortableItemRow({
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
      <Card
        {...(canCurate ? attributes : {})}
        {...(canCurate ? listeners : {})}
        className={cn(kindTint(item.kind), 'p-4 flex gap-3', canCurate && 'cursor-grab active:cursor-grabbing')}
      >
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

'use client';

// One sidebar queue card. Pure/presentational — everything it needs comes in
// as props, nothing here closes over DeckView's own state. Split out of
// DeckView.tsx (which had grown past 1900 lines) as a structural move only;
// no rendered output changed.

import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { Submission } from '@/components/SubmissionCard';
import { formatDuration, formatDate, kindTint } from '@/lib/url';
import { Icon } from '@/components/ui/icon';
import { Card } from '@/components/ui/card';
import { SimpleTooltip } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

export function SortableQueueItem({
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
      {/* mr-1.5 keeps the remove button clear of the sidebar's scrollbar —
          without it, the X sits flush against the scroll track and users
          have reported mis-hitting one for the other. */}
      <div className={`flex items-stretch gap-0 mr-1.5 ${selected ? 'bg-ink/5' : ''}`}>
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
                {s.trigger_warning && (
                  <SimpleTooltip content={s.trigger_warning}>
                    <span className="bg-rust text-paper font-bold ml-1 px-1 cursor-default">⚠ TW</span>
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
          className="shrink-0 w-7 flex items-center justify-center text-ink/40 hover:text-rust hover:bg-rust/10 rounded-full transition-colors"
          aria-label="Remove"
          tabIndex={-1}
        >
          <Icon name="remove" className="text-base" />
        </button>
      </div>
    </div>
  );
}

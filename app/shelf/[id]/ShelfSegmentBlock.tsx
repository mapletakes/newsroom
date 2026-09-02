'use client';

// A named block within the shelf — mirrors the deck's SegmentBlock, minus
// the parts that don't apply here: no active-item highlighting, no type
// filter, no multi-select, no "clear all" (shelf items are removed one at a
// time, not rejected in bulk). Collapse state is local/ephemeral — blocks
// here are a planning aid, not something worth a schema column to persist.
// Split out of ShelfDetailView.tsx as a structural move only, no rendered
// output changed.

import { useState } from 'react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { SortableItemRow, type ShelfItem } from './SortableItemRow';
import { SendToDeckMenu, type DeckSegment } from './SendToDeckMenu';

export function ShelfSegmentBlock({
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
  onSendUngrouped,
  onSendSegment,
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
  // Ungrouped has no segment identity to preserve, so it keeps the flat
  // pick-a-target behavior — same as sending an individual item.
  onSendUngrouped?: (segmentId: string | null, label: string) => void;
  // A real segment always becomes its own FRESH deck segment (mirrors
  // rundown's per-block behavior) — no target to pick.
  onSendSegment?: () => void;
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
          {canCurate && items.length > 0 && onSendSegment && (
            <Button variant="outline" size="xs" onClick={onSendSegment}>
              Send segment to deck →
            </Button>
          )}
          {canCurate && items.length > 0 && onSendUngrouped && (
            <SendToDeckMenu segments={deckSegments} onSend={onSendUngrouped} label="Send to deck" size="xs" />
          )}
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

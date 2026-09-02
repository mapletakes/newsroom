'use client';

// One block in the deck's queue — a named segment, or the "ungrouped"
// bucket — wrapping a list of SortableQueueItems with its own block-level
// drag handle. Pure/presentational, same as SortableQueueItem: split out of
// DeckView.tsx as a structural move only, no rendered output changed.

import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { Submission } from '@/components/SubmissionCard';
import { formatDuration } from '@/lib/url';
import { Icon } from '@/components/ui/icon';
import { SimpleTooltip } from '@/components/ui/tooltip';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { SortableQueueItem } from './SortableQueueItem';

export type Segment = { id: string; name: string; position: number; collapsed: boolean };

export function SegmentBlock({
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
        <div className="flex items-center gap-1 mb-1 mr-1.5 bg-ink/10 px-1 py-1">
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
                <Icon name="clearAll" className="text-sm" />
              </button>
            </SimpleTooltip>
          )}
          {onDelete && (
            <button onClick={onDelete} className="shrink-0 w-5 flex items-center justify-center text-ink/30 hover:text-rust" aria-label="Delete segment">
              <Icon name="remove" className="text-sm" />
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

// Server-side mirror of the play-order rule DeckView computes client-side
// (app/deck/DeckView.tsx's `blocks`/`orderedQueue`): items are grouped into
// blocks (segments, plus the ungrouped block sharing the same position
// axis), blocks are sorted by position, and within a block items sort by
// position (nulls last) then newest first. Kept in sync by hand — if you
// change one, change the other.

export type OrderableSegment = { id: string; position: number };

export type OrderableItem = {
  id: string;
  segment_id: string | null;
  position: number | null;
  created_at: string;
};

export function computePlayOrder<T extends OrderableItem>(
  items: T[],
  segments: OrderableSegment[],
  ungroupedPosition: number,
): T[] {
  const known = new Set(segments.map((s) => s.id));
  const blocks = [
    { id: 'ungrouped', position: ungroupedPosition },
    ...segments.map((s) => ({ id: s.id, position: s.position })),
  ].sort((a, b) => a.position - b.position);

  const byPosition = (a: T, b: T) =>
    (a.position ?? 1e9) - (b.position ?? 1e9) ||
    new Date(b.created_at).getTime() - new Date(a.created_at).getTime();

  const flat: T[] = [];
  for (const b of blocks) {
    const inBlock =
      b.id === 'ungrouped'
        ? items.filter((s) => !s.segment_id || !known.has(s.segment_id))
        : items.filter((s) => s.segment_id === b.id);
    flat.push(...inBlock.sort(byPosition));
  }
  return flat;
}

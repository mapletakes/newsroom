// How a shelf is laid out: named segments plus an "ungrouped" bucket, all
// sharing one position axis (lists.ungrouped_position is where the bucket
// sits among the segments' own positions), with items ordered inside each
// block by position then oldest-first. Mirrors the shelf editor's block
// ordering (app/shelf/[id]/ShelfDetailView.tsx) so the read-only shared view
// and a imported copy come out in the same order the owner sees.

export type ShelfSegment = { id: string; name: string; position: number | null };

export type ShelfItemLike = {
  id: string;
  segment_id: string | null;
  position: number | null;
  created_at?: string | null;
};

export type ShelfBlock<T> = {
  /** 'ungrouped' for the bucket, otherwise the segment id. */
  id: string;
  /** null for the ungrouped bucket. */
  name: string | null;
  items: T[];
};

const byPosition = <T extends ShelfItemLike>(a: T, b: T) =>
  (a.position ?? 1e9) - (b.position ?? 1e9) ||
  new Date(a.created_at ?? 0).getTime() - new Date(b.created_at ?? 0).getTime();

/**
 * Items grouped into blocks in shelf order. An item pointing at a segment that
 * no longer exists falls into the ungrouped bucket rather than vanishing.
 * Empty blocks are dropped: a read-only view has no use for an empty header.
 */
export function groupShelfBlocks<T extends ShelfItemLike>(
  items: T[],
  segments: ShelfSegment[],
  ungroupedPosition: number | null,
): ShelfBlock<T>[] {
  const known = new Set(segments.map((s) => s.id));
  const axis = [
    { id: 'ungrouped', name: null as string | null, position: ungroupedPosition ?? 0 },
    ...segments.map((s) => ({ id: s.id, name: s.name as string | null, position: s.position ?? 0 })),
  ].sort((a, b) => a.position - b.position);

  return axis
    .map((b) => ({
      id: b.id,
      name: b.name,
      items: items
        .filter((it) =>
          b.id === 'ungrouped' ? !it.segment_id || !known.has(it.segment_id) : it.segment_id === b.id,
        )
        .sort(byPosition),
    }))
    .filter((b) => b.items.length > 0);
}

/**
 * For copying a shelf: every item with its segment link preserved (dangling
 * links cleared) and positions renumbered 1..n within its own block, in the
 * source's display order, so ties in the source can't reshuffle in the copy.
 */
export function renumberForCopy<T extends ShelfItemLike>(
  items: T[],
  segments: ShelfSegment[],
): (T & { segment_id: string | null; position: number })[] {
  const known = new Set(segments.map((s) => s.id));
  const out: (T & { segment_id: string | null; position: number })[] = [];
  const containers: (string | null)[] = [null, ...segments.map((s) => s.id)];
  for (const c of containers) {
    const inBlock = items
      .filter((it) => (c === null ? !it.segment_id || !known.has(it.segment_id) : it.segment_id === c))
      .sort(byPosition);
    inBlock.forEach((it, i) => out.push({ ...it, segment_id: c, position: i + 1 }));
  }
  return out;
}

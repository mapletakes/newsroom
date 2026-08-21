// Pure array/position math shared by the deck's and shelf's drag handlers
// (app/deck/DeckView.tsx, app/shelf/[id]/ShelfDetailView.tsx). Extracted so
// this can be locked down with tests independent of React/dnd-kit — the
// flash/ordering bugs that have regressed here before were all in this kind
// of index math, not in dnd-kit itself.

/** Map an ordered list of ids to 1-indexed positions, for persisting after a drag. */
export function positionsFromOrder(orderedIds: string[]): Map<string, number> {
  return new Map(orderedIds.map((id, i) => [id, i + 1]));
}

/**
 * Order within a group: by position (nulls last), then newest first. A drag
 * only ever updates the `position` field of the affected rows in place — it
 * doesn't reorder the array those rows live in — so anything rendered in
 * drag order MUST be run through this first, or the visual order silently
 * stops matching `position` the moment it's updated from anywhere but a full
 * refetch (which happens to come back pre-sorted from the server).
 */
export function byPosition<T extends { position: number | null; created_at: string }>(a: T, b: T): number {
  return (a.position ?? 1e9) - (b.position ?? 1e9) || new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
}

/**
 * Insert `movingItems` into `remaining` (the target container's items with
 * the moving ones already filtered out) at the index implied by dropping on
 * `overIdx`. `overIdx` of -1 means "dropped on the container itself, not a
 * specific item" — append to the end. Used for cross-container drags and
 * multi-select drags, where dnd-kit's own arrayMove doesn't apply (the
 * moving set isn't already inside `remaining`).
 */
export function insertAtIndex<T>(remaining: T[], movingItems: T[], overIdx: number): T[] {
  const insertAt = Math.max(0, Math.min(overIdx >= 0 ? overIdx : remaining.length, remaining.length));
  return [...remaining.slice(0, insertAt), ...movingItems, ...remaining.slice(insertAt)];
}

/** True if `result` is the same sequence of ids as `original` — i.e. a drag that ended up a no-op. */
export function isSameOrder<T extends { id: string }>(result: T[], original: T[]): boolean {
  return result.length === original.length && result.every((s, i) => original[i].id === s.id);
}

import { byPosition } from './reorder';
import type { supabaseAdmin } from './supabase';

type Sb = ReturnType<typeof supabaseAdmin>;

/**
 * The position that puts a new item at the true bottom of a deck group (a
 * segment, or the ungrouped list when `segmentId` is null).
 *
 * A group is shown as: every item that has a position, in position order,
 * then every item without one, newest first (see byPosition). Approving
 * without choosing a destination leaves position unset, so a group routinely
 * holds a mix. "Highest position + 1" is only the bottom of the first half:
 * the unpositioned items sit below it, and the item would land in the middle.
 * Worse, ordering high-to-low puts unset values first in Postgres, so reading
 * just the top row can return an unset one and yield the very first position.
 *
 * So this gives each unpositioned item a position after the numbered ones, in
 * the order they're already shown. The group looks exactly as it did, and the
 * returned position is below all of it. Items that already have positions are
 * never touched, and a group with none unset (the common case after any drag)
 * costs no writes.
 *
 * `excludeId` is the item being placed, so it never counts as part of the
 * group it's about to join. A concurrent placement can still pick the same
 * position; the tie then falls back to newest-first, which is harmless.
 */
export async function nextPositionAtBottom(
  sb: Sb,
  streamId: string,
  segmentId: string | null,
  excludeId?: string,
): Promise<number> {
  let q = sb
    .from('submissions')
    .select('id, position, created_at')
    .eq('stream_id', streamId)
    .eq('status', 'approved');
  q = segmentId ? q.eq('segment_id', segmentId) : q.is('segment_id', null);
  if (excludeId) q = q.neq('id', excludeId);
  const { data } = await q;
  const rows = data ?? [];

  const numbered = rows.filter((r) => r.position !== null);
  const unnumbered = rows.filter((r) => r.position === null).sort(byPosition);

  let next = numbered.reduce((max, r) => Math.max(max, r.position as number), 0) + 1;

  const writes = unnumbered.map((r) => ({ id: r.id, position: next++ }));
  const results = await Promise.all(
    writes.map((w) =>
      sb.from('submissions').update({ position: w.position }).eq('id', w.id).eq('stream_id', streamId),
    ),
  );
  // Not worth failing the approval over: the worst case is the new item
  // sorting among the ones that didn't get numbered, which is where it
  // would have landed before this existed.
  if (results.some((r) => r.error)) {
    console.warn('nextPositionAtBottom: failed to number some unpositioned items');
  }

  return next;
}

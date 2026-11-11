import { describe, expect, it, vi } from 'vitest';
import { nextPositionAtBottom } from './group-position';

type Row = { id: string; position: number | null; created_at: string };

/**
 * A chainable stand-in for the supabase query builder. The select resolves to
 * `rows` (the real database would already have applied the filters, so the
 * tests pass in only the rows a correct filter would return, and assert the
 * filters separately). Updates are recorded.
 */
function fakeSb(rows: Row[]) {
  const filters: unknown[][] = [];
  const updates: { id: unknown; position: unknown }[] = [];
  const sb = {
    from() {
      let op = '';
      let payload: Record<string, unknown> = {};
      let updateId: unknown;
      const b: Record<string, unknown> = {
        select: () => ((op = 'select'), b),
        update: (p: Record<string, unknown>) => ((op = 'update'), (payload = p), b),
        eq: (...a: unknown[]) => {
          if (op === 'update' && a[0] === 'id') updateId = a[1];
          else if (op === 'select') filters.push(['eq', ...a]);
          return b;
        },
        is: (...a: unknown[]) => (filters.push(['is', ...a]), b),
        neq: (...a: unknown[]) => (filters.push(['neq', ...a]), b),
        then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => {
          if (op === 'update') updates.push({ id: updateId, position: payload.position });
          const out = op === 'select' ? { data: rows, error: null } : { data: null, error: null };
          return Promise.resolve(out).then(res, rej);
        },
      };
      return b;
    },
  };
  return { sb: sb as never, filters, updates };
}

const row = (id: string, position: number | null, day: number): Row => ({
  id,
  position,
  created_at: `2026-11-${String(day).padStart(2, '0')}T00:00:00.000Z`,
});

describe('nextPositionAtBottom', () => {
  it('returns the first position for an empty group, with no writes', async () => {
    const { sb, updates } = fakeSb([]);
    expect(await nextPositionAtBottom(sb, 's1', 'seg')).toBe(1);
    expect(updates).toEqual([]);
  });

  it('is one past the highest when everything already has a position, with no writes', async () => {
    const { sb, updates } = fakeSb([row('a', 1, 1), row('b', 2, 2), row('c', 3, 3)]);
    expect(await nextPositionAtBottom(sb, 's1', 'seg')).toBe(4);
    expect(updates).toEqual([]);
  });

  it('leaves gaps alone rather than renumbering items that already have a position', async () => {
    const { sb, updates } = fakeSb([row('a', 1, 1), row('b', 7, 2)]);
    expect(await nextPositionAtBottom(sb, 's1', null)).toBe(8);
    expect(updates).toEqual([]);
  });

  it('lands below the unpositioned items too, so it is the true bottom and not the middle', async () => {
    // Shown as: a, b (numbered), then newest-first c, d (unpositioned).
    const { sb, updates } = fakeSb([row('a', 1, 1), row('b', 2, 2), row('d', null, 3), row('c', null, 9)]);

    const pos = await nextPositionAtBottom(sb, 's1', 'seg');

    // The unpositioned items take the next positions in the order they were
    // already shown (newest first), and the new item goes after all of them.
    expect(updates).toEqual([
      { id: 'c', position: 3 },
      { id: 'd', position: 4 },
    ]);
    expect(pos).toBe(5);
  });

  it('does not collapse to the first position when the group has only unpositioned items', async () => {
    // The old lookup read the top row of a high-to-low sort, where Postgres
    // puts unset values first: it saw "no position" and returned 1, putting
    // the new item above every one of these.
    const { sb, updates } = fakeSb([row('x', null, 1), row('y', null, 2)]);

    const pos = await nextPositionAtBottom(sb, 's1', null);

    expect(updates).toEqual([
      { id: 'y', position: 1 },
      { id: 'x', position: 2 },
    ]);
    expect(pos).toBe(3);
  });

  it('keeps unpositioned items in the order the deck was already showing them', async () => {
    const { sb, updates } = fakeSb([row('old', null, 1), row('mid', null, 5), row('new', null, 9)]);
    await nextPositionAtBottom(sb, 's1', null);
    expect(updates.map((u) => u.id)).toEqual(['new', 'mid', 'old']);
  });

  it('scopes to the segment, or to the ungrouped list when there is none, and skips the item being placed', async () => {
    const seg = fakeSb([]);
    await nextPositionAtBottom(seg.sb, 's1', 'seg-1', 'moving');
    expect(seg.filters).toContainEqual(['eq', 'stream_id', 's1']);
    expect(seg.filters).toContainEqual(['eq', 'status', 'approved']);
    expect(seg.filters).toContainEqual(['eq', 'segment_id', 'seg-1']);
    expect(seg.filters).toContainEqual(['neq', 'id', 'moving']);

    const ungrouped = fakeSb([]);
    await nextPositionAtBottom(ungrouped.sb, 's1', null);
    expect(ungrouped.filters).toContainEqual(['is', 'segment_id', null]);
    expect(ungrouped.filters.some((f) => f[0] === 'neq')).toBe(false);
  });

  it('does not throw if numbering an item fails: the approval still goes through', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const failing = {
      from() {
        let op = '';
        const b: Record<string, unknown> = {
          select: () => ((op = 'select'), b),
          update: () => ((op = 'update'), b),
          eq: () => b,
          is: () => b,
          neq: () => b,
          then: (res: (v: unknown) => unknown) =>
            Promise.resolve(
              op === 'select'
                ? { data: [row('a', 1, 1), row('b', null, 2)], error: null }
                : { data: null, error: { message: 'boom' } },
            ).then(res),
        };
        return b;
      },
    };

    await expect(nextPositionAtBottom(failing as never, 's1', null)).resolves.toBe(3);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});

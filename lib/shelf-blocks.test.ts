import { describe, it, expect } from 'vitest';
import { groupShelfBlocks, renumberForCopy } from './shelf-blocks';

const seg = (id: string, name: string, position: number) => ({ id, name, position });
const item = (id: string, segment_id: string | null, position: number | null, created_at = '2026-01-01T00:00:00Z') => ({
  id,
  segment_id,
  position,
  created_at,
});

describe('groupShelfBlocks', () => {
  it('orders blocks on the shared axis and items within them by position', () => {
    const segments = [seg('a', 'Opening', 1), seg('b', 'Deep dive', 3)];
    const items = [item('b2', 'b', 2), item('b1', 'b', 1), item('a1', 'a', 1), item('u1', null, 1)];
    // ungrouped sits at position 2: between the two segments.
    const blocks = groupShelfBlocks(items, segments, 2);
    expect(blocks.map((b) => b.name)).toEqual(['Opening', null, 'Deep dive']);
    expect(blocks[2].items.map((i) => i.id)).toEqual(['b1', 'b2']);
  });

  it('drops empty blocks', () => {
    const blocks = groupShelfBlocks([item('a1', 'a', 1)], [seg('a', 'A', 1), seg('empty', 'Empty', 2)], 0);
    expect(blocks.map((b) => b.id)).toEqual(['a']);
  });

  it('puts items whose segment no longer exists in the ungrouped bucket', () => {
    const blocks = groupShelfBlocks([item('x', 'deleted-seg', 1)], [seg('a', 'A', 1)], 0);
    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toMatchObject({ id: 'ungrouped', name: null });
  });

  it('breaks position ties oldest-first, and sorts null positions last', () => {
    const blocks = groupShelfBlocks(
      [
        item('late', null, 1, '2026-02-01T00:00:00Z'),
        item('early', null, 1, '2026-01-01T00:00:00Z'),
        item('nopos', null, null),
      ],
      [],
      0,
    );
    expect(blocks[0].items.map((i) => i.id)).toEqual(['early', 'late', 'nopos']);
  });
});

describe('renumberForCopy', () => {
  it('keeps each item in its segment and renumbers 1..n per block', () => {
    const segments = [seg('a', 'A', 1), seg('b', 'B', 2)];
    const out = renumberForCopy(
      [item('b1', 'b', 7), item('a2', 'a', 9), item('a1', 'a', 4), item('u1', null, 100)],
      segments,
    );
    const pick = (id: string) => out.find((i) => i.id === id)!;
    expect(pick('a1')).toMatchObject({ segment_id: 'a', position: 1 });
    expect(pick('a2')).toMatchObject({ segment_id: 'a', position: 2 });
    expect(pick('b1')).toMatchObject({ segment_id: 'b', position: 1 });
    expect(pick('u1')).toMatchObject({ segment_id: null, position: 1 });
  });

  it('clears a link to a segment that is not being copied', () => {
    const out = renumberForCopy([item('x', 'gone', 1)], []);
    expect(out[0]).toMatchObject({ segment_id: null, position: 1 });
  });

  it('keeps every item exactly once', () => {
    const items = [item('1', 'a', 1), item('2', null, 1), item('3', 'gone', 2)];
    expect(renumberForCopy(items, [seg('a', 'A', 1)]).map((i) => i.id).sort()).toEqual(['1', '2', '3']);
  });
});

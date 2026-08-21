import { describe, it, expect } from 'vitest';
import { positionsFromOrder, insertAtIndex, isSameOrder, byPosition } from './reorder';

describe('positionsFromOrder', () => {
  it('maps ids to 1-indexed positions in order', () => {
    const pos = positionsFromOrder(['c', 'a', 'b']);
    expect(pos.get('c')).toBe(1);
    expect(pos.get('a')).toBe(2);
    expect(pos.get('b')).toBe(3);
  });

  it('returns an empty map for an empty list', () => {
    expect(positionsFromOrder([]).size).toBe(0);
  });
});

type Item = { id: string };
const items = (...ids: string[]): Item[] => ids.map((id) => ({ id }));

describe('insertAtIndex', () => {
  it('inserts in the middle at the given index', () => {
    const result = insertAtIndex(items('a', 'b', 'c'), items('x'), 1);
    expect(result.map((i) => i.id)).toEqual(['a', 'x', 'b', 'c']);
  });

  it('inserts at the start when overIdx is 0', () => {
    const result = insertAtIndex(items('a', 'b'), items('x'), 0);
    expect(result.map((i) => i.id)).toEqual(['x', 'a', 'b']);
  });

  it('appends to the end when overIdx is -1 (dropped on the container itself)', () => {
    const result = insertAtIndex(items('a', 'b'), items('x'), -1);
    expect(result.map((i) => i.id)).toEqual(['a', 'b', 'x']);
  });

  it('reaches the last slot: overIdx equal to remaining.length lands at the end, not out of bounds', () => {
    const remaining = items('a', 'b', 'c');
    const result = insertAtIndex(remaining, items('x'), remaining.length);
    expect(result.map((i) => i.id)).toEqual(['a', 'b', 'c', 'x']);
  });

  it('clamps an overIdx beyond the array length instead of throwing or dropping items', () => {
    const remaining = items('a', 'b');
    const result = insertAtIndex(remaining, items('x'), 99);
    expect(result.map((i) => i.id)).toEqual(['a', 'b', 'x']);
  });

  it('inserts an empty remaining list correctly (single-item container)', () => {
    const result = insertAtIndex([], items('x'), -1);
    expect(result.map((i) => i.id)).toEqual(['x']);
  });

  it('keeps a multi-select group in its original relative order when inserted together', () => {
    const result = insertAtIndex(items('a', 'd'), items('b', 'c'), 1);
    expect(result.map((i) => i.id)).toEqual(['a', 'b', 'c', 'd']);
  });
});

describe('byPosition', () => {
  type Positioned = { id: string; position: number | null; created_at: string };
  const at = (id: string, position: number | null, created_at = '2026-01-01T00:00:00.000Z'): Positioned => ({
    id,
    position,
    created_at,
  });

  it('sorts ascending by position', () => {
    const result = [at('c', 3), at('a', 1), at('b', 2)].sort(byPosition);
    expect(result.map((i) => i.id)).toEqual(['a', 'b', 'c']);
  });

  it('puts null positions last', () => {
    const result = [at('b', null), at('a', 1)].sort(byPosition);
    expect(result.map((i) => i.id)).toEqual(['a', 'b']);
  });

  it('breaks ties between null positions by newest first', () => {
    const result = [
      at('old', null, '2026-01-01T00:00:00.000Z'),
      at('new', null, '2026-01-02T00:00:00.000Z'),
    ].sort(byPosition);
    expect(result.map((i) => i.id)).toEqual(['new', 'old']);
  });

  it('re-derives the correct order after only the position fields change — the exact operation a drag persists', () => {
    // This is what a completed drag actually does to the underlying array:
    // element order is untouched, only .position values are updated in
    // place (see ShelfDetailView's persistItemOrder / DeckView's
    // persistGroupOrder). Rendering must re-sort by the new values, not
    // rely on array order, or a drag visually does nothing.
    const original = [at('a', 1), at('b', 2), at('c', 3)];
    const afterDrag = original.map((i) => (i.id === 'c' ? { ...i, position: 1 } : i.id === 'a' ? { ...i, position: 3 } : i));
    expect(afterDrag.map((i) => i.id)).toEqual(['a', 'b', 'c']); // array order unchanged
    expect(afterDrag.sort(byPosition).map((i) => i.id)).toEqual(['c', 'b', 'a']); // sorted order reflects the drag
  });
});

describe('isSameOrder', () => {
  it('is true for an identical sequence', () => {
    expect(isSameOrder(items('a', 'b', 'c'), items('a', 'b', 'c'))).toBe(true);
  });

  it('is false when the order differs', () => {
    expect(isSameOrder(items('b', 'a', 'c'), items('a', 'b', 'c'))).toBe(false);
  });

  it('is false when the lengths differ', () => {
    expect(isSameOrder(items('a', 'b'), items('a', 'b', 'c'))).toBe(false);
  });

  it('is true for two empty lists', () => {
    expect(isSameOrder([], [])).toBe(true);
  });
});

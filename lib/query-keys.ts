// Centralized query key factories — one place to see every cache key shape
// used across the deck/mod/shelf views, so a key never silently drifts
// between the place that reads it and the place that invalidates it.
export const queryKeys = {
  queue: (streamId: string | null, status?: string) =>
    status ? (['queue', streamId, status] as const) : (['queue', streamId] as const),
  questions: (streamId: string | null, status?: string) =>
    status ? (['questions', streamId, status] as const) : (['questions', streamId] as const),
  segments: (streamId: string | null) => ['segments', streamId] as const,
  quickLinks: () => ['quick-links'] as const,
  shelves: () => ['shelves'] as const,
  shelf: (shelfId: string) => ['shelf', shelfId] as const,
};

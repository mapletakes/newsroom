// Centralized query key factories — one place to see every cache key shape
// used across the deck/mod/shelf views, so a key never silently drifts
// between the place that reads it and the place that invalidates it.
export const queryKeys = {
  queue: (streamId: string | null, status?: string) =>
    status ? (['queue', streamId, status] as const) : (['queue', streamId] as const),
  questions: (streamId: string | null, status?: string) =>
    status ? (['questions', streamId, status] as const) : (['questions', streamId] as const),
  modStatus: (streamId: string | null) => ['mod-status', streamId] as const,
  raffle: (streamId: string | null) => ['raffle', streamId] as const,
  segments: (streamId: string | null) => ['segments', streamId] as const,
  quickLinks: () => ['quick-links'] as const,
  shelves: () => ['shelves'] as const,
  shelf: (shelfId: string) => ['shelf', shelfId] as const,
  archives: () => ['archives'] as const,
  suspiciousLog: (params?: string) =>
    params === undefined ? (['suspicious-log'] as const) : (['suspicious-log', params] as const),
  suspiciousShares: () => ['suspicious-shares'] as const,
  // A different first element from suspiciousLog's, so invalidating one never
  // reaches the other by prefix.
  suspiciousChatters: (q?: string) =>
    q === undefined ? (['suspicious-chatters'] as const) : (['suspicious-chatters', q] as const),
  // The channel's chatter flags; with a chatter id, just that chatter's live one.
  chatterFlags: (chatterId?: string) =>
    chatterId === undefined ? (['chatter-flags'] as const) : (['chatter-flags', chatterId] as const),
  // Other channels' flags as this channel receives them, per review filter.
  networkFlags: (filter?: string) =>
    filter === undefined ? (['network-flags'] as const) : (['network-flags', filter] as const),
  // The stream-control panel (scene list, relay status, recent commands) and
  // the streamer's full command log in settings.
  streamControl: () => ['stream-control'] as const,
  streamControlLog: () => ['stream-control-log'] as const,
};

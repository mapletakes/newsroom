// The log's filters as database conditions, shared by the list and export
// routes so a filter can never mean something different in one than the other.

import { escapeLike, type LogFilters } from './suspicious-log-query';

// The Supabase query builder's generic types don't carry across a helper
// boundary, so the builder passes through untyped. The callers own the typed
// `select`, and nothing here changes what it returns.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Builder = any;

export function applyLogFilters(query: Builder, filters: LogFilters): Builder {
  let q = query;
  if (filters.q) q = q.ilike('message_text', `%${escapeLike(filters.q)}%`);
  if (filters.user) q = q.ilike('chatter_login', `${escapeLike(filters.user)}%`);
  if (filters.chatterId) q = q.eq('chatter_user_id', filters.chatterId);
  if (filters.status === 'restricted') q = q.eq('low_trust_status', 'restricted');
  if (filters.status === 'other') q = q.neq('low_trust_status', 'restricted');
  if (filters.type) q = q.contains('detection_types', [filters.type]);
  if (filters.from) q = q.gte('sent_at', filters.from);
  if (filters.to) q = q.lt('sent_at', filters.to);
  return q;
}

// The log page's filters and response shapes, shared by the API route and the
// browser. No server-only imports belong here.

// One line per message makes a long page cheap to scan, so pages are large.
export const LOG_PAGE_SIZE = 200;
// A whole page can be selected at once, so a delete must accept one.
export const MAX_DELETE_IDS = 200;

export const STATUS_LABELS: Record<string, string> = {
  restricted: 'Restricted',
  active_monitoring: 'Monitored',
  none: 'No status',
};

export const DETECTION_LABELS: Record<string, string> = {
  manually_added: 'Added by a mod',
  ban_evader: 'Possible ban evader',
  banned_in_shared_channel: 'Banned in a shared channel',
};

export type LogFilters = {
  q: string;
  user: string;
  chatterId: string;
  status: 'all' | 'restricted' | 'other';
  type: string;
  from: string;
  to: string;
  order: 'newest' | 'oldest';
  page: number;
};

export const DEFAULT_LOG_FILTERS: LogFilters = {
  q: '',
  user: '',
  chatterId: '',
  status: 'all',
  type: '',
  from: '',
  to: '',
  order: 'newest',
  page: 1,
};

export type LogMessage = {
  id: string;
  chatter_user_id: string;
  chatter_login: string;
  chatter_name: string;
  message_text: string;
  low_trust_status: string;
  detection_types: string[];
  ban_evasion_evaluation: string | null;
  shared_ban_channel_ids: string[];
  sent_at: string;
};

export type LogStatusChange = {
  id: string;
  moderator_login: string | null;
  low_trust_status: string;
  changed_at: string;
};

export type LogResponse = {
  items: LogMessage[];
  total: number;
  page: number;
  pageSize: number;
  statusChanges: LogStatusChange[];
  canDelete: boolean;
  logEnabled: boolean;
  logStatus: 'off' | 'active' | 'needs_reconnect' | 'stopped';
  logStatusAt: string | null;
};

/** A chatter in the log, as the picker lists them. `status` and `name` come
 *  from their most recent message. */
export type LogChatter = {
  id: string;
  login: string;
  name: string;
  status: string;
  last_seen: string;
};

export type ChattersResponse = { chatters: LogChatter[] };

function isoOrEmpty(value: string | null): string {
  if (!value) return '';
  const time = Date.parse(value);
  return Number.isNaN(time) ? '' : new Date(time).toISOString();
}

export function parseLogFilters(params: URLSearchParams): LogFilters {
  const status = params.get('status');
  const type = params.get('type') ?? '';
  const chatterId = params.get('chatterId') ?? '';
  const page = Number.parseInt(params.get('page') ?? '1', 10);
  return {
    q: (params.get('q') ?? '').trim().slice(0, 200),
    user: (params.get('user') ?? '').trim().replace(/^@/, '').toLowerCase().slice(0, 40),
    chatterId: /^\d{1,20}$/.test(chatterId) ? chatterId : '',
    status: status === 'restricted' || status === 'other' ? status : 'all',
    type: Object.hasOwn(DETECTION_LABELS, type) ? type : '',
    from: isoOrEmpty(params.get('from')),
    to: isoOrEmpty(params.get('to')),
    order: params.get('order') === 'oldest' ? 'oldest' : 'newest',
    page: Number.isInteger(page) && page >= 1 && page <= 100_000 ? page : 1,
  };
}

export function toLogSearchParams(filters: LogFilters): URLSearchParams {
  const params = new URLSearchParams();
  if (filters.q) params.set('q', filters.q);
  if (filters.user) params.set('user', filters.user);
  if (filters.chatterId) params.set('chatterId', filters.chatterId);
  if (filters.status !== 'all') params.set('status', filters.status);
  if (filters.type) params.set('type', filters.type);
  if (filters.from) params.set('from', filters.from);
  if (filters.to) params.set('to', filters.to);
  if (filters.order !== 'newest') params.set('order', filters.order);
  if (filters.page > 1) params.set('page', String(filters.page));
  return params;
}

/** Makes text match literally inside a SQL LIKE pattern. */
export function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (c) => `\\${c}`);
}

/** The start of a local calendar day (`YYYY-MM-DD`), plus any whole days. */
export function localDayToIso(day: string, addDays = 0): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return '';
  const date = new Date(`${day}T00:00:00`);
  if (Number.isNaN(date.getTime())) return '';
  date.setDate(date.getDate() + addDays);
  return date.toISOString();
}

const pad = (n: number) => String(n).padStart(2, '0');

/** `YYYY-MM-DD` in the viewer's time zone, for grouping a log by day. */
export function localDayKey(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** `HH:MM:SS` in the viewer's time zone. Built by hand rather than with Intl so
 *  every log line has the same fixed width in every locale. */
export function formatLogTime(iso: string): string {
  const d = new Date(iso);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

export function formatLogDay(iso: string): string {
  return new Date(iso).toLocaleDateString([], {
    weekday: 'short',
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

/** Splits an already-ordered list into runs that share a calendar day, so each
 *  line needs only a time and the date appears once above its group. */
export function groupByDay<T extends { sent_at: string }>(
  items: T[],
): { key: string; label: string; items: T[] }[] {
  const groups: { key: string; label: string; items: T[] }[] = [];
  for (const item of items) {
    const key = localDayKey(item.sent_at);
    const last = groups[groups.length - 1];
    if (last && last.key === key) last.items.push(item);
    else groups.push({ key, label: formatLogDay(item.sent_at), items: [item] });
  }
  return groups;
}

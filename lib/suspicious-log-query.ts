// The log page's filters and response shapes, shared by the API route and the
// browser. No server-only imports belong here.

export const LOG_PAGE_SIZE = 50;
export const MAX_DELETE_IDS = 100;

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

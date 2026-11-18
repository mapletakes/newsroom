'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { AppHeader } from '@/components/AppHeader';
import { Button } from '@/components/ui/button';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { queryKeys } from '@/lib/query-keys';
import { useDebouncedValue } from '@/lib/use-debounced-value';
import { toText } from '@/lib/suspicious-log-export';
import {
  DETECTION_LABELS,
  LOG_PAGE_SIZE,
  MAX_DELETE_IDS,
  MAX_EXPORT_ROWS,
  STATUS_LABELS,
  formatLogTime,
  groupByDay,
  localDayKey,
  localDayToIso,
  toLogSearchParams,
  type LogFilters,
  type LogMessage,
  type LogResponse,
} from '@/lib/suspicious-log-query';
import { formatDateTime } from '@/lib/url';
import { ChatterPicker, type PickedChatter } from './ChatterPicker';
import { ShareDialog, SharedLinksDialog, copyText, type ShareTarget } from './ShareDialogs';
import { StatusDot } from './StatusDot';

const controlClass =
  'h-8 border border-ink/30 bg-paper px-1.5 font-mono text-xs focus:border-ink focus:outline-none';

// Everything the person has chosen. Days are kept as the date inputs hold them
// and only become timestamps when the request is built.
type UiState = {
  chatter: PickedChatter | null;
  q: string;
  status: LogFilters['status'];
  type: string;
  fromDay: string;
  toDay: string;
  order: LogFilters['order'];
  page: number;
};

const DEFAULT_UI: UiState = {
  chatter: null,
  q: '',
  status: 'all',
  type: '',
  fromDay: '',
  toDay: '',
  order: 'newest',
  page: 1,
};

async function fetchLog(params: string): Promise<LogResponse> {
  const r = await fetch(`/api/suspicious-log${params ? `?${params}` : ''}`);
  if (!r.ok) throw new Error('Failed to load the log');
  return r.json();
}

function CaptureNotice({ data }: { data: LogResponse }) {
  if (data.logStatus === 'active') return null;
  const since = data.logStatusAt ? ` since ${formatDateTime(data.logStatusAt)}` : '';
  const message =
    data.logStatus === 'needs_reconnect'
      ? 'The streamer needs to sign out and back in with Twitch to resume logging.'
      : data.logStatus === 'stopped'
        ? 'Twitch ended the connection. An admin can reconnect it from the channel’s admin page.'
        : 'The suspicious log is turned off for this channel.';
  return (
    <div role="status" className="mb-2 border-2 border-rust px-3 py-1.5 text-xs">
      <strong className="font-bold">Logging isn’t running{since}.</strong> {message} Messages sent
      while logging is stopped can’t be recovered.
    </div>
  );
}

function detailsOf(message: LogMessage): string {
  const sharedBans = message.shared_ban_channel_ids.length;
  return [
    STATUS_LABELS[message.low_trust_status] ?? message.low_trust_status,
    ...message.detection_types.map((type) => DETECTION_LABELS[type] ?? type),
    message.ban_evasion_evaluation ? `Ban evasion: ${message.ban_evasion_evaluation}` : null,
    sharedBans > 0 ? `Banned in ${sharedBans} shared channel${sharedBans === 1 ? '' : 's'}` : null,
  ]
    .filter(Boolean)
    .join(' · ');
}

// One line per message: time, a status dot, who said it, what they said. The
// rest (why they're flagged) sits behind the time until it's asked for.
function LogRow({
  message,
  showUser,
  selected,
  expanded,
  onSelect,
  onToggle,
  onOpenUser,
}: {
  message: LogMessage;
  showUser: boolean;
  selected: boolean;
  expanded: boolean;
  onSelect: () => void;
  onToggle: () => void;
  onOpenUser: () => void;
}) {
  const evasion = message.ban_evasion_evaluation;
  const likelyEvader = evasion === 'possible' || evasion === 'likely';
  return (
    <li className={`hover:bg-ink/5 ${selected ? 'bg-ink/10' : ''}`}>
      <div className="flex items-start gap-2 px-2">
        <input
          type="checkbox"
          checked={selected}
          onChange={onSelect}
          aria-label={`Select message from ${message.chatter_name}`}
          className="mt-1 h-3 w-3 shrink-0 accent-rust"
        />
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={expanded}
          title="Show why this user is flagged"
          className="shrink-0 tabular-nums text-ink/50 hover:text-ink"
        >
          {formatLogTime(message.sent_at)}
        </button>
        <StatusDot status={message.low_trust_status} className="mt-[7px]" />
        {showUser && (
          <button
            type="button"
            onClick={onOpenUser}
            title={`Show every message from ${message.chatter_login}`}
            className="max-w-[9rem] shrink-0 truncate font-bold after:content-[':'] hover:text-rust"
          >
            {message.chatter_name}
          </button>
        )}
        <span className="min-w-0 flex-1 whitespace-pre-wrap break-words">{message.message_text}</span>
        {likelyEvader && (
          <span className="shrink-0 text-[11px] uppercase tracking-wider text-ochre">evasion {evasion}</span>
        )}
      </div>
      {expanded && <div className="px-2 pb-1 pl-6 text-[11px] text-ink/60">{detailsOf(message)}</div>}
    </li>
  );
}

export function SuspiciousLogView({
  displayName,
  isAdmin,
  isMod,
}: {
  displayName: string;
  isAdmin: boolean;
  isMod: boolean;
}) {
  const queryClient = useQueryClient();
  const { confirm, confirmDialog } = useConfirm();
  const [ui, setUi] = useState<UiState>(DEFAULT_UI);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [showHistory, setShowHistory] = useState(false);
  const [shareTarget, setShareTarget] = useState<ShareTarget | null>(null);
  const [shareKey, setShareKey] = useState(0);
  const [linksOpen, setLinksOpen] = useState(false);

  // Searching as you type, without a request per keystroke.
  const debouncedQ = useDebouncedValue(ui.q, 300);
  const filters: LogFilters = useMemo(
    () => ({
      q: debouncedQ.trim(),
      user: '',
      chatterId: ui.chatter?.id ?? '',
      status: ui.status,
      type: ui.type,
      from: localDayToIso(ui.fromDay),
      to: localDayToIso(ui.toDay, 1),
      order: ui.order,
      page: ui.page,
    }),
    [debouncedQ, ui],
  );
  const params = toLogSearchParams(filters).toString();
  const { data, isPending, isError, isPlaceholderData } = useQuery({
    queryKey: queryKeys.suspiciousLog(params),
    queryFn: () => fetchLog(params),
    placeholderData: keepPreviousData,
  });

  // Any change to what's being looked at starts again from page one, and a
  // selection ends with the view it was made in, so a delete can never reach
  // rows the filters have hidden.
  const update = (patch: Partial<UiState>) => {
    setUi((current) => ({ ...current, page: 1, ...patch }));
    setSelected(new Set());
  };
  const goToPage = (page: number) => {
    setUi((current) => ({ ...current, page }));
    setSelected(new Set());
  };
  const pickChatter = (chatter: PickedChatter | null) => {
    setShowHistory(false);
    update({ chatter });
  };
  const hasFilters =
    !!ui.chatter || ui.q.trim() !== '' || ui.status !== 'all' || ui.type !== '' || ui.fromDay !== '' || ui.toDay !== '';

  const remove = useMutation({
    mutationFn: async (ids: string[]) => {
      const r = await fetch('/api/suspicious-log', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids }),
      });
      if (!r.ok) throw new Error('Could not delete those messages');
    },
    onSuccess: (_result, ids) => {
      toast.success(`Deleted ${ids.length} message${ids.length === 1 ? '' : 's'}`);
      setSelected(new Set());
      setUi((current) => ({ ...current, page: 1 }));
    },
    onError: (e: Error) => toast.error(e.message),
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.suspiciousLog() });
      queryClient.invalidateQueries({ queryKey: queryKeys.suspiciousChatters() });
    },
  });

  const deleteSelected = async () => {
    const ids = [...selected];
    const n = ids.length;
    const ok = await confirm({
      title: `Permanently delete ${n} message${n === 1 ? '' : 's'}?`,
      description: 'Deleted messages can’t be recovered, because Twitch keeps no copy we can fetch again.',
      confirmText: `Delete ${n}`,
      destructive: true,
    });
    if (ok) remove.mutate(ids);
  };

  const items = data?.items ?? [];
  const total = data?.total ?? 0;
  const pageSize = data?.pageSize ?? LOG_PAGE_SIZE;
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const canDelete = data?.canDelete === true;
  const history = data?.statusChanges ?? [];
  const days = useMemo(() => groupByDay(items), [items]);
  const pageIds = items.map((m) => m.id);
  const pageAllSelected = pageIds.length > 0 && pageIds.every((id) => selected.has(id));
  const rangeFrom = items.length ? (ui.page - 1) * pageSize + 1 : 0;
  const rangeTo = items.length ? rangeFrom + items.length - 1 : 0;
  const chatter = ui.chatter;

  // A fresh key per opening, so a link made last time never shows in the next.
  const openShare = (target: ShareTarget) => {
    setShareKey((key) => key + 1);
    setShareTarget(target);
  };

  // Copied in the order they were said, whichever way the page is sorted.
  const copySelected = () => {
    const picked = items.filter((m) => selected.has(m.id));
    const ordered = ui.order === 'newest' ? picked.reverse() : picked;
    copyText(
      toText(ordered, (iso) => `${localDayKey(iso)} ${formatLogTime(iso)}`),
      `Copied ${picked.length} message${picked.length === 1 ? '' : 's'}`,
    );
  };

  // Downloads cover every page of what the filters match, not just this one.
  const exportHref = (format: 'csv' | 'txt') => {
    const exportParams = new URLSearchParams(params);
    exportParams.delete('page');
    exportParams.set('format', format);
    return `/api/suspicious-log/export?${exportParams}`;
  };

  const toggleIn = (set: Set<string>, id: string) => {
    const next = new Set(set);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    return next;
  };

  const pager = (where: 'top' | 'bottom') =>
    pageCount > 1 && (
      <nav aria-label={`Log pages (${where})`} className="flex items-center gap-2">
        <span>
          {rangeFrom}–{rangeTo} of {total}
        </span>
        <Button variant="outline" size="xs" onClick={() => goToPage(ui.page - 1)} disabled={ui.page <= 1}>
          ‹ Prev
        </Button>
        <Button variant="outline" size="xs" onClick={() => goToPage(ui.page + 1)} disabled={ui.page >= pageCount}>
          Next ›
        </Button>
      </nav>
    );

  return (
    <div className="flex min-h-screen flex-col">
      {confirmDialog}
      {shareTarget && <ShareDialog key={shareKey} target={shareTarget} onClose={() => setShareTarget(null)} />}
      <SharedLinksDialog open={linksOpen} onOpenChange={setLinksOpen} isStreamer={canDelete} />
      <AppHeader
        className="border-b-2 border-ink px-6 py-3 gap-6"
        section="suspicious log"
        right={
          <>
            {!isMod && <Link href="/deck" className="underline hover:text-rust">Streamer Deck</Link>}
            <Link href="/mod" className="underline hover:text-rust">Mod View</Link>
            {!isMod && <Link href="/setup" className="underline hover:text-rust">Settings</Link>}
            {isAdmin && <Link href="/admin" className="underline hover:text-rust">Admin</Link>}
            <span>{displayName}</span>
          </>
        }
      />

      <main className="mx-auto w-full max-w-6xl flex-1 px-3 pb-8 sm:px-6">
        <div className="flex flex-wrap items-baseline gap-x-4 gap-y-0.5 py-3">
          <h1 className="font-display text-xl font-bold">Suspicious log</h1>
          <p className="text-xs text-ink/60">
            Messages Twitch reports from flagged users. Streamer and current mods only; deleted after one year.
          </p>
        </div>

        {data && <CaptureNotice data={data} />}

        <div className="sticky top-0 z-10 -mx-3 border-b border-ink/20 bg-paper px-3 py-2 sm:-mx-6 sm:px-6">
          <div className="flex flex-wrap items-center gap-2">
            <ChatterPicker selected={ui.chatter} onSelect={pickChatter} onClear={() => pickChatter(null)} />
            <Input
              type="search"
              value={ui.q}
              onChange={(e) => update({ q: e.target.value })}
              placeholder="Search messages…"
              aria-label="Search messages"
              className="h-8 min-w-[10rem] flex-1 py-0 text-xs"
            />
            <select
              aria-label="Status"
              value={ui.status}
              onChange={(e) => update({ status: e.target.value as LogFilters['status'] })}
              className={controlClass}
            >
              <option value="all">All statuses</option>
              <option value="restricted">Restricted</option>
              <option value="other">Other</option>
            </select>
            <select
              aria-label="Detection"
              value={ui.type}
              onChange={(e) => update({ type: e.target.value })}
              className={controlClass}
            >
              <option value="">Any detection</option>
              {Object.entries(DETECTION_LABELS).map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
            <label className="flex items-center gap-1 font-mono text-[11px] text-ink/60">
              <span>From</span>
              <input
                type="date"
                value={ui.fromDay}
                onChange={(e) => update({ fromDay: e.target.value })}
                className={controlClass}
              />
            </label>
            <label className="flex items-center gap-1 font-mono text-[11px] text-ink/60">
              <span>To</span>
              <input
                type="date"
                value={ui.toDay}
                onChange={(e) => update({ toDay: e.target.value })}
                className={controlClass}
              />
            </label>
            <select
              aria-label="Order"
              value={ui.order}
              onChange={(e) => update({ order: e.target.value as LogFilters['order'] })}
              className={controlClass}
            >
              <option value="newest">Newest first</option>
              <option value="oldest">Oldest first</option>
            </select>
            {hasFilters && (
              <Button variant="ghost" size="xs" onClick={() => update({ ...DEFAULT_UI, order: ui.order })}>
                Clear
              </Button>
            )}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-ink/10 py-1.5 font-mono text-[11px] text-ink/60">
          <span aria-live="polite">
            {total} message{total === 1 ? '' : 's'}
            {ui.chatter ? ` from ${ui.chatter.name}` : ''}
          </span>
          {ui.chatter && history.length > 0 && (
            <button
              type="button"
              onClick={() => setShowHistory((open) => !open)}
              aria-expanded={showHistory}
              className="underline hover:text-ink"
            >
              Status history ({history.length})
            </button>
          )}
          {items.length > 0 && (
            <label className="flex items-center gap-1.5">
              <input
                type="checkbox"
                checked={pageAllSelected}
                onChange={() => setSelected(pageAllSelected ? new Set() : new Set(pageIds))}
                className="h-3 w-3 accent-rust"
              />
              Select page
            </label>
          )}
          {selected.size > 0 && (
            <>
              <Button variant="outline" size="xs" onClick={copySelected}>
                Copy
              </Button>
              <Button
                variant="outline"
                size="xs"
                onClick={() => openShare({ kind: 'messages', messageIds: [...selected] })}
              >
                Share {selected.size}
              </Button>
              {canDelete && (
                <Button
                  variant="destructive"
                  size="xs"
                  onClick={deleteSelected}
                  disabled={remove.isPending || selected.size > MAX_DELETE_IDS}
                >
                  {remove.isPending ? 'Deleting…' : `Delete ${selected.size}`}
                </Button>
              )}
            </>
          )}
          {chatter && (
            <Button
              variant="outline"
              size="xs"
              onClick={() => openShare({ kind: 'chatter', chatterId: chatter.id, chatterName: chatter.name })}
              title={`Link to everything ${chatter.name} has said here`}
            >
              Share all
            </Button>
          )}
          {items.length > 0 && (
            <>
              <a
                href={exportHref('csv')}
                className="underline hover:text-ink"
                title={`Download everything these filters match, up to ${MAX_EXPORT_ROWS.toLocaleString()} messages`}
              >
                Export CSV
              </a>
              <a href={exportHref('txt')} className="underline hover:text-ink">
                Export text
              </a>
            </>
          )}
          <button type="button" onClick={() => setLinksOpen(true)} className="underline hover:text-ink">
            Shared links
          </button>
          <div className="ml-auto">{pager('top')}</div>
        </div>

        {showHistory && history.length > 0 && (
          <ul aria-label="Status history" className="border-b border-ink/10 py-1.5 font-mono text-[11px] text-ink/70">
            {history.map((change) => (
              <li key={change.id} className="px-2">
                {formatDateTime(change.changed_at)} — set to{' '}
                {STATUS_LABELS[change.low_trust_status] ?? change.low_trust_status}
                {change.moderator_login ? ` by ${change.moderator_login}` : ''}
              </li>
            ))}
          </ul>
        )}

        {isPending ? (
          <div className="space-y-1.5 py-2">
            {Array.from({ length: 8 }, (_, i) => <Skeleton key={i} className="h-4 w-full" />)}
          </div>
        ) : isError ? (
          <p className="py-12 text-center font-mono text-sm text-rust">Couldn&apos;t load the log. Try reloading.</p>
        ) : items.length === 0 ? (
          <div className="py-12 text-center font-mono text-sm text-ink/60">
            {hasFilters ? 'No messages match these filters.' : 'Nothing logged yet. Messages appear here as Twitch reports them.'}
          </div>
        ) : (
          <>
            <ul className={`py-1 font-mono text-[13px] leading-5 ${isPlaceholderData ? 'opacity-60' : ''}`}>
              {days.map((day) => (
                <li key={day.key} className="list-none">
                  <div className="mt-2 border-b border-ink/10 px-2 pb-0.5 text-[11px] uppercase tracking-widest text-ink/50">
                    {day.label}
                  </div>
                  <ul>
                    {day.items.map((message) => (
                      <LogRow
                        key={message.id}
                        message={message}
                        showUser={!ui.chatter}
                        selected={selected.has(message.id)}
                        expanded={expanded.has(message.id)}
                        onSelect={() => setSelected((current) => toggleIn(current, message.id))}
                        onToggle={() => setExpanded((current) => toggleIn(current, message.id))}
                        onOpenUser={() => pickChatter({ id: message.chatter_user_id, name: message.chatter_name })}
                      />
                    ))}
                  </ul>
                </li>
              ))}
            </ul>
            <div className="mt-2 font-mono text-[11px] text-ink/60">{pager('bottom')}</div>
          </>
        )}
      </main>
    </div>
  );
}

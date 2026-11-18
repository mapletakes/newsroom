'use client';

import { useState, type FormEvent } from 'react';
import Link from 'next/link';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { AppHeader } from '@/components/AppHeader';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { queryKeys } from '@/lib/query-keys';
import {
  DEFAULT_LOG_FILTERS,
  DETECTION_LABELS,
  MAX_DELETE_IDS,
  STATUS_LABELS,
  localDayToIso,
  toLogSearchParams,
  type LogFilters,
  type LogMessage,
  type LogResponse,
} from '@/lib/suspicious-log-query';
import { formatDateTime } from '@/lib/url';

const selectClass =
  'border border-ink/30 bg-paper px-2 py-1.5 font-mono text-sm focus:outline-none focus:border-ink';
const labelClass = 'font-mono text-[11px] uppercase tracking-widest text-ink/60';

const EMPTY_DRAFT = { q: '', user: '', fromDay: '', toDay: '' };

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
    <div role="status" className="mb-4 border-2 border-rust px-3 py-2 text-sm">
      <strong className="font-bold">Logging isn’t running{since}.</strong> {message} Messages sent
      while logging is stopped can’t be recovered.
    </div>
  );
}

function MessageRow({
  message,
  canDelete,
  selected,
  onSelect,
  onOpenUser,
}: {
  message: LogMessage;
  canDelete: boolean;
  selected: boolean;
  onSelect: () => void;
  onOpenUser: () => void;
}) {
  const evasion = message.ban_evasion_evaluation;
  const sharedBans = message.shared_ban_channel_ids.length;
  return (
    <Card className={`flex items-start gap-3 px-3 py-2 ${selected ? 'border-ink bg-ink/5' : ''}`}>
      {canDelete && (
        <input
          type="checkbox"
          checked={selected}
          onChange={onSelect}
          aria-label={`Select message from ${message.chatter_name}`}
          className="mt-1 h-4 w-4 shrink-0 accent-rust"
        />
      )}
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 font-mono text-[11px] text-ink/60">
          <button
            type="button"
            onClick={onOpenUser}
            className="text-sm font-bold text-ink underline-offset-2 hover:text-rust hover:underline"
            title={`View all messages from ${message.chatter_login}`}
          >
            {message.chatter_name}
          </button>
          <time dateTime={message.sent_at}>{formatDateTime(message.sent_at)}</time>
          <Badge variant="outline" className="px-1 py-0 text-[10px] leading-4">
            {STATUS_LABELS[message.low_trust_status] ?? message.low_trust_status}
          </Badge>
          {message.detection_types.map((type) => (
            <Badge key={type} variant="outline" className="px-1 py-0 text-[10px] leading-4">
              {DETECTION_LABELS[type] ?? type}
            </Badge>
          ))}
          {(evasion === 'possible' || evasion === 'likely') && (
            <Badge variant="warning" className="border px-1 py-0 text-[10px] leading-4">
              Ban evasion {evasion}
            </Badge>
          )}
          {sharedBans > 0 && (
            <span>
              Banned in {sharedBans} shared channel{sharedBans === 1 ? '' : 's'}
            </span>
          )}
        </div>
        <p className="mt-1 whitespace-pre-wrap break-words text-sm">{message.message_text}</p>
      </div>
    </Card>
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
  const [filters, setFilters] = useState<LogFilters>(DEFAULT_LOG_FILTERS);
  const [draft, setDraft] = useState(EMPTY_DRAFT);
  const [historyName, setHistoryName] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const params = toLogSearchParams(filters).toString();
  const { data, isPending, isError } = useQuery({
    queryKey: queryKeys.suspiciousLog(params),
    queryFn: () => fetchLog(params),
    placeholderData: keepPreviousData,
  });

  const update = (next: Partial<LogFilters>) => {
    setFilters((current) => ({ ...current, page: 1, ...next }));
    setSelected(new Set());
  };

  const applyDraft = (e: FormEvent) => {
    e.preventDefault();
    update({
      q: draft.q.trim(),
      user: draft.user.trim().replace(/^@/, '').toLowerCase(),
      from: localDayToIso(draft.fromDay),
      to: localDayToIso(draft.toDay, 1),
    });
  };

  const clearAll = () => {
    setDraft(EMPTY_DRAFT);
    setHistoryName('');
    update(DEFAULT_LOG_FILTERS);
  };

  const openUser = (message: LogMessage) => {
    setHistoryName(message.chatter_name);
    update({ chatterId: message.chatter_user_id });
  };

  const closeUser = () => {
    setHistoryName('');
    update({ chatterId: '' });
  };

  const goToPage = (page: number) => {
    setFilters((current) => ({ ...current, page }));
    setSelected(new Set());
  };

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
      setFilters((current) => ({ ...current, page: 1 }));
    },
    onError: (e: Error) => toast.error(e.message),
    onSettled: () => queryClient.invalidateQueries({ queryKey: queryKeys.suspiciousLog() }),
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
  const canDelete = data?.canDelete === true;
  const pageIds = items.map((m) => m.id);
  const pageAllSelected = pageIds.length > 0 && pageIds.every((id) => selected.has(id));
  const pageCount = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;
  const filtered = params !== '' && params !== `page=${filters.page}`;

  const toggle = (id: string) =>
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <div className="min-h-screen flex flex-col">
      {confirmDialog}
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

      <main className="px-4 sm:px-6 py-8 max-w-4xl mx-auto w-full flex-1">
        <div className="mb-6">
          <h1 className="font-display text-3xl font-bold mb-2">Suspicious log</h1>
          <p className="text-sm text-ink/60 max-w-2xl">
            Messages Twitch reports from users flagged as suspicious in this channel. Only the
            streamer and current moderators can open this page. Entries are deleted after one year.
          </p>
        </div>

        {data && <CaptureNotice data={data} />}

        <form onSubmit={applyDraft} className="mb-4 flex flex-col gap-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="flex flex-col gap-1">
              <span className={labelClass}>Message text</span>
              <Input
                type="search"
                value={draft.q}
                onChange={(e) => setDraft((d) => ({ ...d, q: e.target.value }))}
                placeholder="Search messages…"
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className={labelClass}>Username</span>
              <Input
                type="search"
                value={draft.user}
                onChange={(e) => setDraft((d) => ({ ...d, user: e.target.value }))}
                placeholder="Starts with…"
              />
            </label>
          </div>
          <div className="flex flex-wrap items-end gap-3">
            <label className="flex flex-col gap-1">
              <span className={labelClass}>Status</span>
              <select
                value={filters.status}
                onChange={(e) => update({ status: e.target.value as LogFilters['status'] })}
                className={selectClass}
              >
                <option value="all">All</option>
                <option value="restricted">Restricted</option>
                <option value="other">Other</option>
              </select>
            </label>
            <label className="flex flex-col gap-1">
              <span className={labelClass}>Detection</span>
              <select
                value={filters.type}
                onChange={(e) => update({ type: e.target.value })}
                className={selectClass}
              >
                <option value="">All</option>
                {Object.entries(DETECTION_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>{label}</option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1">
              <span className={labelClass}>From</span>
              <Input
                type="date"
                value={draft.fromDay}
                onChange={(e) => setDraft((d) => ({ ...d, fromDay: e.target.value }))}
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className={labelClass}>To</span>
              <Input
                type="date"
                value={draft.toDay}
                onChange={(e) => setDraft((d) => ({ ...d, toDay: e.target.value }))}
              />
            </label>
            <Button type="submit" variant="outline" size="sm">Apply</Button>
            {filtered && (
              <Button type="button" variant="ghost" size="sm" onClick={clearAll}>Clear filters</Button>
            )}
          </div>
        </form>

        {filters.chatterId && (
          <section aria-label="User history" className="mb-4 border border-ink/30 px-3 py-2">
            <div className="flex items-center gap-3">
              <h2 className="font-display text-lg font-bold">History for {historyName}</h2>
              <button type="button" onClick={closeUser} className="ml-auto font-mono text-xs underline hover:text-rust">
                Back to all users
              </button>
            </div>
            {data && data.statusChanges.length > 0 && (
              <ul className="mt-2 space-y-1 font-mono text-xs text-ink/70">
                {data.statusChanges.map((change) => (
                  <li key={change.id}>
                    {formatDateTime(change.changed_at)}: set to{' '}
                    {STATUS_LABELS[change.low_trust_status] ?? change.low_trust_status}
                    {change.moderator_login ? ` by ${change.moderator_login}` : ''}
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}

        {isPending ? (
          <div className="space-y-2">
            {[0, 1, 2].map((i) => <Skeleton key={i} className="h-20 w-full" />)}
          </div>
        ) : isError ? (
          <p className="text-center py-16 font-mono text-sm text-rust">Couldn&apos;t load the log. Try reloading.</p>
        ) : items.length === 0 ? (
          <div className="text-center py-16">
            <p className="font-display text-2xl mb-2">{filtered ? 'No matches.' : 'Nothing logged yet.'}</p>
            <p className="text-ink/60 font-mono text-sm">
              {filtered ? 'Try different filters.' : 'Messages appear here as Twitch reports them.'}
            </p>
          </div>
        ) : (
          <>
            <div className="mb-2 flex flex-wrap items-center gap-x-4 gap-y-2 font-mono text-xs">
              <span className="text-ink/60" aria-live="polite">
                {data?.total} message{data?.total === 1 ? '' : 's'}
              </span>
              {canDelete && (
                <label className="flex items-center gap-2 text-ink/80">
                  <input
                    type="checkbox"
                    checked={pageAllSelected}
                    onChange={() => setSelected(pageAllSelected ? new Set() : new Set(pageIds))}
                    className="h-4 w-4 accent-rust"
                  />
                  Select page
                </label>
              )}
              {canDelete && selected.size > 0 && (
                <Button
                  variant="destructive"
                  size="xs"
                  onClick={deleteSelected}
                  disabled={remove.isPending || selected.size > MAX_DELETE_IDS}
                >
                  {remove.isPending ? 'Deleting…' : `Delete ${selected.size}`}
                </Button>
              )}
            </div>

            <div className="space-y-1.5">
              {items.map((message) => (
                <MessageRow
                  key={message.id}
                  message={message}
                  canDelete={canDelete}
                  selected={selected.has(message.id)}
                  onSelect={() => toggle(message.id)}
                  onOpenUser={() => openUser(message)}
                />
              ))}
            </div>

            {pageCount > 1 && (
              <nav aria-label="Log pages" className="mt-3 flex items-center gap-2 font-mono text-xs">
                <Button variant="outline" size="xs" onClick={() => goToPage(filters.page - 1)} disabled={filters.page <= 1}>
                  ‹ Prev
                </Button>
                <span className="text-ink/80">Page {filters.page} of {pageCount}</span>
                <Button variant="outline" size="xs" onClick={() => goToPage(filters.page + 1)} disabled={filters.page >= pageCount}>
                  Next ›
                </Button>
              </nav>
            )}
          </>
        )}
      </main>
    </div>
  );
}

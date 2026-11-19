'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { Skeleton } from '@/components/ui/skeleton';
import { queryKeys } from '@/lib/query-keys';
import {
  FLAG_CATEGORIES,
  REVIEW_DECISIONS,
  type NetworkChatter,
  type NetworkFilter,
  type NetworkFlag,
  type NetworkResponse,
  type ReviewDecision,
} from '@/lib/chatter-flag-types';
import { STATUS_LABELS, formatLogTime, localDayKey } from '@/lib/suspicious-log-query';
import { formatDateTime, relativeTime } from '@/lib/url';

const controlClass =
  'h-8 border border-ink/30 bg-paper px-1.5 font-mono text-xs focus:border-ink focus:outline-none';

const FILTERS: { value: NetworkFilter; label: string }[] = [
  { value: 'new', label: 'New' },
  { value: 'all', label: 'All' },
  { value: 'banned', label: 'Banned' },
  { value: 'watching', label: 'Watching' },
  { value: 'dismissed', label: 'Dismissed' },
];

async function fetchNetwork(filter: NetworkFilter): Promise<NetworkResponse> {
  const r = await fetch(`/api/suspicious-log/network?filter=${filter}`);
  if (!r.ok) throw new Error('Failed to load network flags');
  return r.json();
}

async function send(url: string, method: 'POST' | 'DELETE', body: unknown, fallback: string) {
  const r = await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(typeof data.error === 'string' && data.error.includes(' ') ? data.error : fallback);
  return data;
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

function FlagCard({ flag }: { flag: NetworkFlag }) {
  const changed = flag.updated_at && flag.updated_at !== flag.created_at;
  return (
    <li className="border-l-2 border-ink/20 pl-3">
      <div className="flex flex-wrap items-baseline gap-x-3 text-xs">
        <span className="font-bold">{flag.channelName}</span>
        <span className="text-ink/70">
          flagged by{' '}
          <a
            href={`https://www.twitch.tv/${encodeURIComponent(flag.flaggedBy)}`}
            target="_blank"
            rel="noopener noreferrer"
            title="Who made this flag, to ask for details"
            className="underline hover:text-ink"
          >
            {flag.flaggedBy}
          </a>
        </span>
        <span>{FLAG_CATEGORIES[flag.category]}</span>
        <span className="text-ink/60" title={formatDateTime(flag.created_at)}>
          {relativeTime(flag.created_at)}
          {changed ? ` · updated ${relativeTime(flag.updated_at!)}` : ''}
        </span>
      </div>
      {flag.context && (
        <div className="mt-1">
          <div className="text-[11px] uppercase tracking-wider text-ink/50">{flag.channelName}&apos;s account</div>
          <p className="whitespace-pre-wrap break-words text-xs">{flag.context}</p>
        </div>
      )}
      {flag.messages.length > 0 && (
        <div className="mt-1">
          <div className="text-[11px] uppercase tracking-wider text-ink/50">
            {plural(flag.messages.length, 'message')} captured by Twitch in {flag.channelName}&apos;s chat
          </div>
          <ul className="text-[12px] leading-5">
            {flag.messages.map((m) => (
              <li key={m.id} className="flex gap-2">
                <span className="shrink-0 tabular-nums text-ink/50">
                  {localDayKey(m.sent_at)} {formatLogTime(m.sent_at)}
                </span>
                <span className="shrink-0 text-ink/50">{STATUS_LABELS[m.low_trust_status] ?? m.low_trust_status}</span>
                <span className="min-w-0 whitespace-pre-wrap break-words">{m.message_text}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </li>
  );
}

function ChatterCard({
  chatter,
  busy,
  onDecide,
  onClear,
  onOpenInLog,
}: {
  chatter: NetworkChatter;
  busy: boolean;
  onDecide: (decision: ReviewDecision) => void;
  onClear: () => void;
  onOpenInLog: () => void;
}) {
  const channels = new Set(chatter.flags.map((f) => f.channelName)).size;
  const review = chatter.review;
  return (
    <li className="border-b border-ink/15 py-3 font-mono">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="text-sm font-bold">{chatter.chatter_name}</span>
        {chatter.chatter_name.toLowerCase() !== chatter.chatter_login && (
          <span className="text-xs text-ink/60">{chatter.chatter_login}</span>
        )}
        {chatter.isNew && (
          <span className="bg-rust px-1.5 text-[11px] uppercase tracking-wider text-paper">
            {review ? 'new since review' : 'new'}
          </span>
        )}
        <span className="text-xs text-ink/60" title="How many channels flagged them">
          {plural(channels, 'channel')}
        </span>
        {chatter.inMyLog && (
          <button type="button" onClick={onOpenInLog} className="text-xs text-ochre underline hover:text-ink">
            In your log
          </button>
        )}
        {channels === 1 && <span className="text-[11px] text-ink/50">one channel&apos;s report so far</span>}
      </div>

      <ul className="mt-2 grid gap-3">
        {chatter.flags.map((flag) => (
          <FlagCard key={flag.id} flag={flag} />
        ))}
      </ul>

      <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
        {(Object.keys(REVIEW_DECISIONS) as ReviewDecision[]).map((decision) => (
          <Button
            key={decision}
            size="xs"
            variant={review?.decision === decision ? 'default' : 'outline'}
            aria-pressed={review?.decision === decision}
            disabled={busy}
            onClick={() => onDecide(decision)}
          >
            {REVIEW_DECISIONS[decision]}
          </Button>
        ))}
        {review && (
          <>
            <span className="text-[11px] text-ink/60">
              {REVIEW_DECISIONS[review.decision]} by {review.decided_by_login} {relativeTime(review.decided_at)}
            </span>
            <Button variant="ghost" size="xs" onClick={onClear} disabled={busy}>
              Clear
            </Button>
          </>
        )}
      </div>
    </li>
  );
}

/**
 * Other channels' flags, for this channel to decide whether to ban the same
 * people. Recording "Banned" here is a note for the team; the ban itself still
 * happens on Twitch.
 */
export function NetworkFlagsView({ onOpenInLog }: { onOpenInLog: (chatter: { id: string; name: string }) => void }) {
  const queryClient = useQueryClient();
  const { confirm, confirmDialog } = useConfirm();
  const [filter, setFilter] = useState<NetworkFilter>('new');
  const { data, isPending, isError } = useQuery({
    queryKey: queryKeys.networkFlags(filter),
    queryFn: () => fetchNetwork(filter),
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: queryKeys.networkFlags() });

  const subscribe = useMutation({
    mutationFn: (subscribed: boolean) =>
      send('/api/suspicious-log/network/subscription', 'POST', { subscribed }, 'Could not save that'),
    onSuccess: (_d, subscribed) =>
      toast.success(subscribed ? 'This channel now receives network flags' : 'Stopped receiving network flags'),
    onError: (e: Error) => toast.error(e.message),
    onSettled: invalidate,
  });

  const review = useMutation({
    mutationFn: ({ chatterId, decision }: { chatterId: string; decision: ReviewDecision | null }) =>
      decision
        ? send('/api/suspicious-log/network/review', 'POST', { chatterId, decision }, 'Could not save the decision')
        : send('/api/suspicious-log/network/review', 'DELETE', { chatterId }, 'Could not clear the decision'),
    onError: (e: Error) => toast.error(e.message),
    onSettled: invalidate,
  });

  const stopReceiving = async () => {
    const ok = await confirm({
      title: 'Stop receiving network flags?',
      description:
        'Your team stops seeing other channels’ flags. Decisions you’ve recorded are kept, and flags your channel makes are still shared.',
      confirmText: 'Stop receiving',
      destructive: true,
    });
    if (ok) subscribe.mutate(false);
  };

  if (isPending) {
    return (
      <div className="space-y-2 py-4">
        {[0, 1, 2].map((i) => <Skeleton key={i} className="h-16 w-full" />)}
      </div>
    );
  }
  if (isError || !data) {
    return <p className="py-12 text-center font-mono text-sm text-rust">Couldn&apos;t load network flags. Try reloading.</p>;
  }

  if (!data.logEnabled) {
    return (
      <p className="py-12 text-center font-mono text-sm text-ink/60">
        Network flags need the suspicious log turned on for this channel.
      </p>
    );
  }

  if (!data.subscribed) {
    return (
      <div className="mx-auto max-w-xl py-12 text-center font-mono text-sm">
        {confirmDialog}
        <p className="mb-2 font-bold">This channel isn&apos;t receiving network flags.</p>
        <p className="mb-4 text-ink/70">
          Other channels using the suspicious log flag chatters who caused trouble there, with the messages Twitch
          captured and their own account of what happened. Turning this on lets you and your mods review those flags and
          decide whether to ban the same people here.
        </p>
        {data.canSubscribe ? (
          <Button onClick={() => subscribe.mutate(true)} disabled={subscribe.isPending}>
            {subscribe.isPending ? 'Turning on…' : 'Receive network flags'}
          </Button>
        ) : (
          <p className="text-ink/60">Only the streamer can turn this on.</p>
        )}
      </div>
    );
  }

  return (
    <div>
      {confirmDialog}
      <div className="flex flex-wrap items-center gap-2 border-b border-ink/20 py-2 font-mono text-[11px]">
        <select
          aria-label="Show"
          value={filter}
          onChange={(e) => setFilter(e.target.value as NetworkFilter)}
          className={controlClass}
        >
          {FILTERS.map((f) => (
            <option key={f.value} value={f.value}>{f.label}</option>
          ))}
        </select>
        <span className="text-ink/60" aria-live="polite">
          {plural(data.chatters.length, 'chatter')}
        </span>
        {data.canSubscribe && (
          <button type="button" onClick={stopReceiving} className="ml-auto underline hover:text-ink">
            Stop receiving
          </button>
        )}
      </div>
      <p className="border-b border-ink/10 py-1.5 font-mono text-[11px] text-ink/60">
        These are other channels&apos; reports, not verdicts. Messages are as Twitch captured them; each channel&apos;s
        account is its own words. Recording a decision here doesn&apos;t ban anyone on Twitch.
      </p>
      {data.truncated && (
        <p role="status" className="border-b border-ochre py-1.5 font-mono text-[11px]">
          Showing the 500 most recent flags. Older ones aren&apos;t listed.
        </p>
      )}
      {data.chatters.length === 0 ? (
        <p className="py-12 text-center font-mono text-sm text-ink/60">
          {filter === 'new' ? 'Nothing new to review.' : 'No chatters here.'}
        </p>
      ) : (
        <ul aria-label="Flagged chatters">
          {data.chatters.map((chatter) => (
            <ChatterCard
              key={chatter.chatter_user_id}
              chatter={chatter}
              busy={review.isPending}
              onDecide={(decision) => review.mutate({ chatterId: chatter.chatter_user_id, decision })}
              onClear={() => review.mutate({ chatterId: chatter.chatter_user_id, decision: null })}
              onOpenInLog={() => onOpenInLog({ id: chatter.chatter_user_id, name: chatter.chatter_name })}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

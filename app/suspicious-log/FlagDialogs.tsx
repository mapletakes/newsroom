'use client';

import { useState, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { queryKeys } from '@/lib/query-keys';
import {
  FLAG_CATEGORIES,
  MAX_FLAG_CONTEXT,
  isFlagCategory,
  type ChannelFlag,
  type FlagCategory,
  type FlagsResponse,
  type FlagTarget,
} from '@/lib/chatter-flag-types';
import { formatLogTime, localDayKey, STATUS_LABELS } from '@/lib/suspicious-log-query';
import { formatDateTime, relativeTime } from '@/lib/url';

const fieldClass = 'w-full border border-ink/30 bg-paper px-2 py-1.5 font-mono text-xs focus:border-ink focus:outline-none';

async function fetchFlags(chatterId?: string): Promise<FlagsResponse> {
  const r = await fetch(`/api/suspicious-log/flags${chatterId ? `?chatterId=${chatterId}` : ''}`);
  if (!r.ok) throw new Error('Failed to load flags');
  return r.json();
}

async function send(method: 'POST' | 'PATCH' | 'DELETE', body: unknown, fallback: string) {
  const r = await fetch('/api/suspicious-log/flags', {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await r.json().catch(() => ({}));
  // Messages written for people come back as sentences; the terse ones don't.
  if (!r.ok) throw new Error(typeof data.error === 'string' && data.error.includes(' ') ? data.error : fallback);
  return data;
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** Who sees a flag, said the same way everywhere a flag is made. */
function SharingNote() {
  return (
    <p className="border-l-2 border-ochre pl-2 font-mono text-[11px] text-ink/70">
      Flags are shared with other channels in the network under this channel&apos;s name, so they can decide whether
      to ban this chatter too. They won&apos;t see who on your team made the flag. Flags expire after a year.
    </p>
  );
}

function FlagForm({
  messageCount,
  initial,
  submitLabel,
  busy,
  blocked = false,
  canReword,
  onSubmit,
  onCancel,
  children,
}: {
  messageCount: number;
  initial?: { category: FlagCategory; context: string };
  submitLabel: string;
  busy: boolean;
  /** Held back by something outside the form, like an empty username. */
  blocked?: boolean;
  /** False for a mod adding evidence to a teammate's flag: what it says isn't theirs to change. */
  canReword: boolean;
  onSubmit: (values: { category: FlagCategory; context: string }) => void;
  onCancel: () => void;
  children?: ReactNode;
}) {
  const [category, setCategory] = useState<FlagCategory | ''>(initial?.category ?? '');
  const [context, setContext] = useState(initial?.context ?? '');
  const needsContext = messageCount === 0;
  const trimmed = context.trim();
  const ready = category !== '' && (!needsContext || trimmed !== '') && context.length <= MAX_FLAG_CONTEXT;

  return (
    <form
      className="grid gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (ready) onSubmit({ category, context: trimmed });
      }}
    >
      {children}
      <label className="grid gap-1 font-mono text-xs">
        <span className="font-bold">Category</span>
        <select
          value={category}
          onChange={(e) => setCategory(isFlagCategory(e.target.value) ? e.target.value : '')}
          disabled={!canReword}
          className={`${fieldClass} h-8 py-0`}
          required
        >
          <option value="">Choose one…</option>
          {Object.entries(FLAG_CATEGORIES).map(([value, label]) => (
            <option key={value} value={value}>{label}</option>
          ))}
        </select>
      </label>
      <label className="grid gap-1 font-mono text-xs">
        <span className="font-bold">
          Context {needsContext ? <span className="font-normal text-rust">(required)</span> : <span className="font-normal text-ink/60">(optional)</span>}
        </span>
        <textarea
          value={context}
          onChange={(e) => setContext(e.target.value)}
          readOnly={!canReword}
          rows={7}
          maxLength={MAX_FLAG_CONTEXT}
          placeholder={
            needsContext
              ? 'What happened, in your own words. With no log messages attached, this is all other channels will have to go on: when it happened, what they said or did, and why they were banned.'
              : 'Anything the messages don’t show: what led up to it, what happened off the log, why they were banned.'
          }
          className={`${fieldClass} resize-y leading-5`}
        />
        <span className="flex justify-between text-[11px] text-ink/60">
          <span>Shown to other channels as your channel&apos;s account, apart from the messages Twitch captured.</span>
          <span className="tabular-nums">
            {context.length}/{MAX_FLAG_CONTEXT}
          </span>
        </span>
      </label>
      <SharingNote />
      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" size="sm" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" size="sm" disabled={!ready || busy || blocked}>
          {busy ? 'Saving…' : submitLabel}
        </Button>
      </div>
    </form>
  );
}

function invalidateFlags(queryClient: ReturnType<typeof useQueryClient>) {
  queryClient.invalidateQueries({ queryKey: queryKeys.chatterFlags() });
}

/**
 * Flags a chatter, or adds to this channel's flag on them if there already is
 * one: the network sees one flag per channel, however many mods weigh in.
 */
export function FlagDialog({ target, onClose }: { target: FlagTarget; onClose: () => void }) {
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-xl">
        {target.kind === 'login' ? <FlagByLogin onClose={onClose} /> : <FlagChatter target={target} onClose={onClose} />}
      </DialogContent>
    </Dialog>
  );
}

function FlagChatter({
  target,
  onClose,
}: {
  target: Extract<FlagTarget, { kind: 'chatter' }>;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const { data, isPending, isError } = useQuery({
    queryKey: queryKeys.chatterFlags(target.chatterId),
    queryFn: () => fetchFlags(target.chatterId),
  });
  const existing = data?.flags[0];
  const adding = target.messageIds.length;

  const create = useMutation({
    mutationFn: (values: { category: FlagCategory; context: string }) =>
      send('POST', { chatterId: target.chatterId, messageIds: target.messageIds, ...values }, 'Could not flag this chatter'),
    onSuccess: () => {
      toast.success(`Flagged ${target.chatterName}`);
      onClose();
    },
    onError: (e: Error) => toast.error(e.message),
    onSettled: () => invalidateFlags(queryClient),
  });

  const update = useMutation({
    mutationFn: (values: { category?: FlagCategory; context?: string }) =>
      send('PATCH', { id: existing!.id, addMessageIds: target.messageIds, ...values }, 'Could not update the flag'),
    onSuccess: () => {
      toast.success(adding > 0 ? `Added ${plural(adding, 'message')} to the flag` : 'Flag updated');
      onClose();
    },
    onError: (e: Error) => toast.error(e.message),
    onSettled: () => invalidateFlags(queryClient),
  });

  const attached = adding > 0 ? ` with ${plural(adding, 'selected message')}` : '';

  return (
    <>
      <DialogHeader>
        <DialogTitle>{existing ? `${target.chatterName} is already flagged` : `Flag ${target.chatterName}`}</DialogTitle>
        <DialogDescription>
          {existing
            ? `${existing.mine ? 'You' : existing.created_by_login} flagged them ${relativeTime(existing.created_at)}, with ${plural(existing.messages.length, 'message')}.${
                adding > 0 ? ` This adds ${plural(adding, 'more')}.` : ''
              }`
            : `Flag this chatter for other channels to review${attached}.`}
        </DialogDescription>
      </DialogHeader>
      {isPending ? (
        <div className="space-y-2">
          {[0, 1, 2].map((i) => <Skeleton key={i} className="h-6 w-full" />)}
        </div>
      ) : isError ? (
        <p className="py-6 text-center font-mono text-sm text-rust">Couldn&apos;t check for an existing flag.</p>
      ) : existing && !existing.canEdit && adding === 0 ? (
        // A teammate's flag with nothing to add: show it, change nothing.
        <div className="grid gap-3 font-mono text-xs">
          <div>
            <span className="font-bold">{FLAG_CATEGORIES[existing.category]}</span>
            {existing.context && <p className="mt-1 whitespace-pre-wrap break-words">{existing.context}</p>}
          </div>
          <p className="text-[11px] text-ink/60">
            To add evidence, select their messages in the log and choose Flag. Only the streamer or whoever made the
            flag can change what it says.
          </p>
          <div className="flex justify-end">
            <Button size="sm" onClick={onClose}>
              Close
            </Button>
          </div>
        </div>
      ) : existing ? (
        <FlagForm
          key={existing.id}
          messageCount={existing.messages.length + adding}
          initial={{ category: existing.category, context: existing.context }}
          canReword={existing.canEdit}
          submitLabel={adding > 0 ? `Add ${plural(adding, 'message')}` : 'Save changes'}
          busy={update.isPending}
          onCancel={onClose}
          onSubmit={(values) => update.mutate(existing.canEdit ? values : {})}
        />
      ) : (
        <FlagForm
          messageCount={adding}
          canReword
          submitLabel="Flag chatter"
          busy={create.isPending}
          onCancel={onClose}
          onSubmit={(values) => create.mutate(values)}
        />
      )}
    </>
  );
}

function FlagByLogin({ onClose }: { onClose: () => void }) {
  const queryClient = useQueryClient();
  const [login, setLogin] = useState('');

  const create = useMutation({
    mutationFn: (values: { category: FlagCategory; context: string }) =>
      send('POST', { login: login.trim(), ...values }, 'Could not flag this chatter'),
    onSuccess: (data: { flag?: { chatterName?: string } }) => {
      toast.success(`Flagged ${data.flag?.chatterName ?? login.trim()}`);
      onClose();
    },
    onError: (e: Error) => toast.error(e.message),
    onSettled: () => invalidateFlags(queryClient),
  });

  return (
    <>
      <DialogHeader>
        <DialogTitle>Flag someone not in the log</DialogTitle>
        <DialogDescription>
          For a chatter who was banned before Twitch or a mod marked them suspicious, so there are no log messages to
          attach. The context you write is the whole flag, so make it count.
        </DialogDescription>
      </DialogHeader>
      <FlagForm
        messageCount={0}
        canReword
        submitLabel="Flag chatter"
        busy={create.isPending}
        blocked={login.trim() === ''}
        onCancel={onClose}
        onSubmit={(values) => create.mutate(values)}
      >
        <label className="grid gap-1 font-mono text-xs">
          <span className="font-bold">Twitch username</span>
          <Input
            value={login}
            onChange={(e) => setLogin(e.target.value)}
            placeholder="username"
            autoComplete="off"
            spellCheck={false}
            maxLength={26}
            required
            className="h-8 text-xs"
          />
        </label>
      </FlagForm>
    </>
  );
}

const STATUS_TEXT: Record<ChannelFlag['status'], string> = {
  active: 'live',
  withdrawn: 'withdrawn',
  expired: 'expired',
};

function FlagRow({
  flag,
  busy,
  onEdit,
  onWithdraw,
}: {
  flag: ChannelFlag;
  busy: boolean;
  onEdit: () => void;
  onWithdraw: () => void;
}) {
  const [open, setOpen] = useState(false);
  const live = flag.status === 'active';
  return (
    <li className={`border-b border-ink/10 py-2 font-mono text-xs ${live ? '' : 'opacity-60'}`}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className="min-w-0 max-w-[12rem] truncate font-bold hover:text-rust"
          title={flag.chatter_login}
        >
          {flag.chatter_name}
        </button>
        <span>{FLAG_CATEGORIES[flag.category]}</span>
        <span className="text-ink/60">{plural(flag.messages.length, 'message')}</span>
        <span className="text-ink/60">by {flag.mine ? 'you' : flag.created_by_login}</span>
        <span className="text-ink/60" title={formatDateTime(flag.created_at)}>{relativeTime(flag.created_at)}</span>
        <span className={live ? 'text-ink/60' : 'text-rust'}>{STATUS_TEXT[flag.status]}</span>
        <span className="ml-auto flex items-center gap-2">
          {live && flag.canEdit && (
            <>
              <Button variant="outline" size="xs" onClick={onEdit}>
                Edit
              </Button>
              <Button variant="outlineDestructive" size="xs" onClick={onWithdraw} disabled={busy}>
                Withdraw
              </Button>
            </>
          )}
        </span>
      </div>
      {open && (
        <div className="mt-2 grid gap-2 pl-2">
          {flag.context && (
            <div>
              <div className="text-[11px] uppercase tracking-wider text-ink/50">Context, in your channel&apos;s words</div>
              <p className="whitespace-pre-wrap break-words">{flag.context}</p>
            </div>
          )}
          {flag.messages.length > 0 && (
            <div>
              <div className="text-[11px] uppercase tracking-wider text-ink/50">Messages, as Twitch captured them</div>
              <ul>
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
          <div className="text-[11px] text-ink/50">Expires {formatDateTime(flag.expires_at)}</div>
        </div>
      )}
    </li>
  );
}

/** Every flag this channel has made. The whole team sees all of them, with who
 *  made each; the streamer can change or withdraw any, a mod only their own. */
export function FlagsDialog({
  open,
  onOpenChange,
  onEdit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onEdit: (flag: ChannelFlag) => void;
}) {
  const queryClient = useQueryClient();
  const { confirm, confirmDialog } = useConfirm();
  const { data, isPending, isError } = useQuery({
    queryKey: queryKeys.chatterFlags(),
    queryFn: () => fetchFlags(),
    enabled: open,
  });

  const withdraw = useMutation({
    mutationFn: (id: string) => send('DELETE', { id }, 'Could not withdraw the flag'),
    onSuccess: () => toast.success('Flag withdrawn'),
    onError: (e: Error) => toast.error(e.message),
    onSettled: () => invalidateFlags(queryClient),
  });

  const askWithdraw = async (flag: ChannelFlag) => {
    const ok = await confirm({
      title: `Withdraw the flag on ${flag.chatter_name}?`,
      description: 'Other channels will stop seeing it. The log messages it pointed at stay in your log.',
      confirmText: 'Withdraw',
      destructive: true,
    });
    if (ok) withdraw.mutate(flag.id);
  };

  const flags = data?.flags ?? [];
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        {confirmDialog}
        <DialogHeader>
          <DialogTitle>Your channel&apos;s flags</DialogTitle>
          <DialogDescription>
            Chatters this channel has flagged for the network. Other channels see the chatter, category, context and
            messages under this channel&apos;s name, never who made the flag.
          </DialogDescription>
        </DialogHeader>
        {isPending ? (
          <div className="space-y-2">
            {[0, 1, 2].map((i) => <Skeleton key={i} className="h-6 w-full" />)}
          </div>
        ) : isError ? (
          <p className="py-6 text-center font-mono text-sm text-rust">Couldn&apos;t load flags.</p>
        ) : flags.length === 0 ? (
          <p className="py-6 text-center font-mono text-sm text-ink/60">No flags yet.</p>
        ) : (
          <ul aria-label="Flags" className="max-h-[60vh] overflow-auto">
            {flags.map((flag) => (
              <FlagRow
                key={flag.id}
                flag={flag}
                busy={withdraw.isPending}
                onEdit={() => onEdit(flag)}
                onWithdraw={() => askWithdraw(flag)}
              />
            ))}
          </ul>
        )}
      </DialogContent>
    </Dialog>
  );
}

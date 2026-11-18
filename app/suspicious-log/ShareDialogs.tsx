'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { queryKeys } from '@/lib/query-keys';
import { SHARE_TTL_DAYS, type SharesResponse, type ShareSummary } from '@/lib/suspicious-log-query';
import { formatDateTime, relativeTime } from '@/lib/url';

export type ShareTarget =
  | { kind: 'messages'; messageIds: string[] }
  | { kind: 'chatter'; chatterId: string; chatterName: string };

export async function copyText(text: string, success: string) {
  try {
    await navigator.clipboard.writeText(text);
    toast.success(success);
  } catch {
    toast.error('Could not copy — your browser blocked clipboard access');
  }
}

/**
 * Makes one link. Creating it is its own click, after the person has been told
 * who will be able to read it: a link to withheld chat shouldn't come into
 * being as a side effect of opening a dialog.
 */
export function ShareDialog({ target, onClose }: { target: ShareTarget; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [created, setCreated] = useState<{ url: string; expiresAt: string } | null>(null);

  const create = useMutation({
    mutationFn: async () => {
      const body =
        target.kind === 'chatter'
          ? { kind: 'chatter', chatterId: target.chatterId }
          : { kind: 'messages', messageIds: target.messageIds };
      const r = await fetch('/api/suspicious-log/share', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await r.json().catch(() => ({}));
      // The one refusal worth explaining: there's something the person can do.
      if (!r.ok) throw new Error(r.status === 409 && data.error ? data.error : 'Could not create the link');
      return data.share as { url: string; expiresAt: string };
    },
    onSuccess: (share) => {
      setCreated(share);
      queryClient.invalidateQueries({ queryKey: queryKeys.suspiciousShares() });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const what =
    target.kind === 'chatter'
      ? `everything ${target.chatterName} has said in this channel so far`
      : `${target.messageIds.length} selected message${target.messageIds.length === 1 ? '' : 's'}`;

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Share a link</DialogTitle>
          <DialogDescription>
            This makes a link to {what}. Anyone who has the link can read what&apos;s in it, with the chatter&apos;s
            username, without signing in. It stops working after {SHARE_TTL_DAYS} days or when it&apos;s revoked, and
            messages that are deleted later disappear from it.
          </DialogDescription>
        </DialogHeader>

        {created ? (
          <div className="grid gap-3">
            <Input
              readOnly
              value={created.url}
              aria-label="Share link"
              onFocus={(e) => e.currentTarget.select()}
              className="w-full text-xs"
            />
            <p className="font-mono text-[11px] text-ink/60">
              Expires {formatDateTime(created.expiresAt)}. You can revoke it any time from Shared links.
            </p>
            <div className="flex justify-end gap-2">
              <Button variant="outline" size="sm" onClick={() => copyText(created.url, 'Link copied')}>
                Copy link
              </Button>
              <Button size="sm" onClick={onClose}>
                Done
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex justify-end gap-2">
            <Button variant="outline" size="sm" onClick={onClose}>
              Cancel
            </Button>
            <Button size="sm" onClick={() => create.mutate()} disabled={create.isPending}>
              {create.isPending ? 'Creating…' : 'Create link'}
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

async function fetchShares(): Promise<SharesResponse> {
  const r = await fetch('/api/suspicious-log/share');
  if (!r.ok) throw new Error('Failed to load links');
  return r.json();
}

function ShareRow({
  share,
  canRevoke,
  showAuthor,
  busy,
  onRevoke,
}: {
  share: ShareSummary;
  canRevoke: boolean;
  showAuthor: boolean;
  busy: boolean;
  onRevoke: () => void;
}) {
  const active = share.status === 'active';
  const url = share.url;
  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-ink/10 py-2 font-mono text-xs">
      <span className="min-w-0 max-w-[12rem] truncate font-bold" title={share.label}>
        {share.label}
      </span>
      <span className="text-ink/60">{share.kind === 'chatter' ? 'all messages' : 'selected messages'}</span>
      {showAuthor && <span className="text-ink/60">by {share.created_by_login}</span>}
      <span className="text-ink/60">{relativeTime(share.created_at)}</span>
      <span className={active ? 'text-ink/60' : 'text-rust'}>
        {active ? `expires ${formatDateTime(share.expires_at)}` : share.status}
      </span>
      <span className="ml-auto flex items-center gap-2">
        {active && url && (
          <Button variant="outline" size="xs" onClick={() => copyText(url, 'Link copied')}>
            Copy link
          </Button>
        )}
        {active && canRevoke && (
          <Button variant="outlineDestructive" size="xs" onClick={onRevoke} disabled={busy}>
            Revoke
          </Button>
        )}
      </span>
    </li>
  );
}

/** Every link, with the means to copy or revoke it. A mod sees and revokes only
 *  their own; the streamer sees and revokes them all. */
export function SharedLinksDialog({
  open,
  onOpenChange,
  isStreamer,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  isStreamer: boolean;
}) {
  const queryClient = useQueryClient();
  const { data, isPending, isError } = useQuery({
    queryKey: queryKeys.suspiciousShares(),
    queryFn: fetchShares,
    enabled: open,
  });

  const revoke = useMutation({
    mutationFn: async (id: string) => {
      const r = await fetch('/api/suspicious-log/share', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      });
      if (!r.ok) throw new Error('Could not revoke the link');
    },
    onSuccess: () => toast.success('Link revoked'),
    onError: (e: Error) => toast.error(e.message),
    onSettled: () => queryClient.invalidateQueries({ queryKey: queryKeys.suspiciousShares() }),
  });

  const shares = data?.shares ?? [];
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Shared links</DialogTitle>
          <DialogDescription>
            {isStreamer
              ? 'Every link made for this channel. Revoking one stops it working at once.'
              : 'The links you’ve made. Revoking one stops it working at once, and the streamer can see and revoke any link.'}
          </DialogDescription>
        </DialogHeader>
        {isPending ? (
          <div className="space-y-2">
            {[0, 1, 2].map((i) => <Skeleton key={i} className="h-6 w-full" />)}
          </div>
        ) : isError ? (
          <p className="py-6 text-center font-mono text-sm text-rust">Couldn&apos;t load links.</p>
        ) : shares.length === 0 ? (
          <p className="py-6 text-center font-mono text-sm text-ink/60">No links yet.</p>
        ) : (
          <ul aria-label="Shared links" className="max-h-80 overflow-auto">
            {shares.map((share) => (
              <ShareRow
                key={share.id}
                share={share}
                canRevoke={isStreamer || share.mine}
                showAuthor={isStreamer && !share.mine}
                busy={revoke.isPending}
                onRevoke={() => revoke.mutate(share.id)}
              />
            ))}
          </ul>
        )}
      </DialogContent>
    </Dialog>
  );
}

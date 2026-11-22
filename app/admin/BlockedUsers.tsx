'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { Input } from '@/components/ui/input';
import type { BlockedUser } from '@/lib/blocked-users';
import { formatDateTime } from '@/lib/url';

/** Who is blocked from the whole app, and the means to block or unblock. */
export function BlockedUsers({ initial }: { initial: BlockedUser[] }) {
  const [users, setUsers] = useState(initial);
  const [login, setLogin] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState('');
  const { confirm, confirmDialog } = useConfirm();

  const name = login.trim().replace(/^@/, '').toLowerCase();

  const block = async () => {
    if (!name) return;
    const ok = await confirm({
      title: `Block ${name}?`,
      description:
        'They’re signed out within seconds, removed as a moderator from every channel here, and can’t sign in again, including to their own channel, until you unblock them. This doesn’t remove them as a moderator on Twitch.',
      confirmText: 'Block',
      destructive: true,
    });
    if (!ok) return;

    setBusy('new');
    setError('');
    const r = await fetch('/api/admin/blocked', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ login: name, reason: reason.trim() }),
    });
    const data = await r.json().catch(() => ({}));
    setBusy(null);
    if (!r.ok) {
      setError(data.error || 'Couldn’t block that user.');
      return;
    }
    setUsers((list) => [data.user, ...list.filter((u) => u.twitch_user_id !== data.user.twitch_user_id)]);
    setLogin('');
    setReason('');
  };

  const unblock = async (user: BlockedUser) => {
    setBusy(user.twitch_user_id);
    setError('');
    const r = await fetch('/api/admin/blocked', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ twitchUserId: user.twitch_user_id }),
    });
    setBusy(null);
    if (!r.ok) {
      setError('Couldn’t unblock that user.');
      return;
    }
    setUsers((list) => list.filter((u) => u.twitch_user_id !== user.twitch_user_id));
  };

  return (
    <div>
      {confirmDialog}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          block();
        }}
        className="mb-4 flex flex-wrap items-center gap-2"
      >
        <Input
          value={login}
          onChange={(e) => setLogin(e.target.value)}
          placeholder="Twitch username"
          aria-label="Twitch username to block"
          autoComplete="off"
          spellCheck={false}
          className="h-8 w-56 py-0 text-xs"
        />
        <Input
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Reason (optional)"
          aria-label="Reason for blocking"
          maxLength={200}
          className="h-8 min-w-[12rem] flex-1 py-0 text-xs"
        />
        <Button type="submit" variant="destructive" size="sm" disabled={!name || busy === 'new'}>
          {busy === 'new' ? 'Blocking…' : 'Block'}
        </Button>
      </form>
      {error && (
        <p role="alert" className="mb-3 font-mono text-xs text-rust">
          {error}
        </p>
      )}

      {users.length === 0 ? (
        <p className="font-mono text-xs text-ink/50">Nobody is blocked.</p>
      ) : (
        <ul aria-label="Blocked users" className="font-mono text-xs">
          {users.map((user) => (
            <li
              key={user.twitch_user_id}
              className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-ink/10 py-2"
            >
              <span className="font-bold">{user.twitch_login}</span>
              <span className="text-ink/60">
                blocked by {user.blocked_by_login}, {formatDateTime(user.created_at)}
              </span>
              {user.reason && <span className="min-w-0 break-words text-ink/70">{user.reason}</span>}
              <Button
                variant="outline"
                size="xs"
                className="ml-auto"
                onClick={() => unblock(user)}
                disabled={busy === user.twitch_user_id}
              >
                {busy === user.twitch_user_id ? '…' : 'Unblock'}
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

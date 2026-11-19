// Network chatter flags: validating requests, resolving who is being flagged,
// and housekeeping. Server only.

import type { supabaseAdmin } from './supabase';
import {
  FLAG_TTL_DAYS,
  MAX_FLAG_CONTEXT,
  MAX_FLAG_MESSAGES,
  isFlagCategory,
  type FlagCategory,
  type FlagStatus,
} from './chatter-flag-types';
import { chunk } from './suspicious-log-query';
import { getAppAccessToken } from './twitch-eventsub';

type Sb = ReturnType<typeof supabaseAdmin>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TWITCH_ID = /^\d{1,20}$/;
const TWITCH_LOGIN = /^[a-z0-9_]{1,25}$/;

export const CONTEXT_REQUIRED = 'Add context: a flag with no log messages needs a written account.';

type Parsed<T> = { ok: true; value: T } | { ok: false; error: string };
const fail = (error: string) => ({ ok: false, error }) as const;

/** Message ids from a request: uuids, deduplicated, within the limit. */
function parseMessageIds(value: unknown): string[] | null {
  if (value === undefined) return [];
  if (!Array.isArray(value)) return null;
  if (!value.every((id) => typeof id === 'string' && UUID.test(id))) return null;
  const unique = [...new Set(value as string[])];
  return unique.length <= MAX_FLAG_MESSAGES ? unique : null;
}

/** Context as stored: trimmed, line endings normalised. Null when too long or not text. */
function parseContext(value: unknown): string | null {
  if (value === undefined) return '';
  if (typeof value !== 'string') return null;
  const text = value.replace(/\r\n?/g, '\n').trim();
  return text.length <= MAX_FLAG_CONTEXT ? text : null;
}

export type CreateFlagRequest = {
  target: { kind: 'chatter'; chatterId: string } | { kind: 'login'; login: string };
  category: FlagCategory;
  context: string;
  messageIds: string[];
};

/**
 * A chatter is named either by their Twitch id, when they're in this channel's
 * log, or by username, when they never were. Messages can only come with the
 * first, and without any the context has to say what happened.
 */
export function parseCreateFlag(body: unknown): Parsed<CreateFlagRequest> {
  if (!body || typeof body !== 'object') return fail('invalid request');
  const { chatterId, login, category, context, messageIds } = body as Record<string, unknown>;

  let target: CreateFlagRequest['target'];
  if (typeof chatterId === 'string' && login === undefined) {
    if (!TWITCH_ID.test(chatterId)) return fail('invalid request');
    target = { kind: 'chatter', chatterId };
  } else if (typeof login === 'string' && chatterId === undefined) {
    const name = login.trim().replace(/^@/, '').toLowerCase();
    if (!TWITCH_LOGIN.test(name)) return fail('That isn’t a valid Twitch username.');
    target = { kind: 'login', login: name };
  } else {
    return fail('invalid request');
  }

  if (!isFlagCategory(category)) return fail('invalid request');
  const text = parseContext(context);
  if (text === null) return fail(`Context can be at most ${MAX_FLAG_CONTEXT} characters.`);
  const ids = parseMessageIds(messageIds);
  if (ids === null) return fail('invalid request');
  if (target.kind === 'login' && ids.length > 0) return fail('invalid request');
  if (ids.length === 0 && text === '') return fail(CONTEXT_REQUIRED);

  return { ok: true, value: { target, category, context: text, messageIds: ids } };
}

export type UpdateFlagRequest = {
  id: string;
  category?: FlagCategory;
  context?: string;
  addMessageIds: string[];
};

export function parseUpdateFlag(body: unknown): Parsed<UpdateFlagRequest> {
  if (!body || typeof body !== 'object') return fail('invalid request');
  const { id, category, context, addMessageIds } = body as Record<string, unknown>;
  if (typeof id !== 'string' || !UUID.test(id)) return fail('invalid request');
  if (category !== undefined && !isFlagCategory(category)) return fail('invalid request');
  const text = context === undefined ? undefined : parseContext(context);
  if (text === null) return fail(`Context can be at most ${MAX_FLAG_CONTEXT} characters.`);
  const ids = parseMessageIds(addMessageIds);
  if (ids === null) return fail('invalid request');
  if (category === undefined && text === undefined && ids.length === 0) return fail('nothing to change');
  return { ok: true, value: { id, category: category as FlagCategory | undefined, context: text, addMessageIds: ids } };
}

export function flagExpiry(now: number): string {
  return new Date(now + FLAG_TTL_DAYS * 24 * 60 * 60 * 1000).toISOString();
}

export function flagStatus(flag: { withdrawn_at: string | null; expires_at: string }, now: number): FlagStatus {
  if (flag.withdrawn_at) return 'withdrawn';
  return new Date(flag.expires_at).getTime() > now ? 'active' : 'expired';
}

export type ChannelMessage = { id: string; chatter_user_id: string; chatter_login: string; chatter_name: string };

/** The named log entries that really belong to this channel, whatever ids the
 *  request names. Throws on a database failure. */
export async function loadChannelMessages(sb: Sb, streamId: string, ids: string[]): Promise<ChannelMessage[]> {
  const found: ChannelMessage[] = [];
  for (const part of chunk(ids)) {
    const { data, error } = await sb
      .from('suspicious_messages')
      .select('id, chatter_user_id, chatter_login, chatter_name')
      .eq('stream_id', streamId)
      .in('id', part);
    if (error) throw new Error(`message lookup failed: ${error.message}`);
    found.push(...((data ?? []) as ChannelMessage[]));
  }
  return found;
}

export type TwitchUser = { id: string; login: string; display_name: string };

/** A Twitch account by username, or null if there's none. Throws when Twitch
 *  can't be asked, so a failure never reads as "no such user". */
export async function lookupTwitchUser(login: string): Promise<TwitchUser | null> {
  const token = await getAppAccessToken();
  const u = new URL('https://api.twitch.tv/helix/users');
  u.searchParams.set('login', login);
  const r = await fetch(u, {
    headers: { Authorization: `Bearer ${token}`, 'Client-Id': process.env.NEXT_PUBLIC_TWITCH_CLIENT_ID! },
  });
  if (!r.ok) throw new Error(`Twitch user lookup failed: ${r.status}`);
  const data = await r.json();
  const user = data.data?.[0];
  return user?.id ? { id: user.id, login: user.login, display_name: user.display_name || user.login } : null;
}

/** Deletes flags past their expiry. Their message links go with them. */
export async function purgeExpiredChatterFlags(sb: Sb, now: number) {
  const { count, error } = await sb
    .from('chatter_flags')
    .delete({ count: 'exact' })
    .lt('expires_at', new Date(now).toISOString());
  return { flagsDeleted: count ?? 0, error: error?.message ?? null };
}

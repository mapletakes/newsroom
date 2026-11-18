import { NextRequest } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { getSuspiciousLogAccess } from '@/lib/suspicious-log-access';
import { denied, reply } from '@/lib/suspicious-log-http';
import {
  MAX_ACTIVE_SHARES,
  chunk,
  type ShareSummary,
  type SharesResponse,
} from '@/lib/suspicious-log-query';
import { newShareToken, parseShareRequest, shareExpiry, shareStatus } from '@/lib/suspicious-log-share';

export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const LIST_LIMIT = 100;

const shareUrl = (req: NextRequest, token: string) =>
  `${(process.env.NEXT_PUBLIC_APP_URL || req.nextUrl.origin).replace(/\/+$/, '')}/sl/${token}`;

// Creates an unlisted link. Streamer and current mods, since a mod who can read
// the log is trusted to hand part of it to someone. The link points at the
// entries rather than copying them (see the table's migration).
export async function POST(req: NextRequest) {
  const access = await getSuspiciousLogAccess();
  if (!access.ok) return denied(access.reason);

  const request = parseShareRequest(await req.json().catch(() => null));
  if (!request) return reply({ error: 'invalid request' }, 400);

  const sb = supabaseAdmin();
  const now = Date.now();

  // A ceiling on live links per channel, so a runaway client can't mint
  // unlimited public pages.
  const { count: active, error: countErr } = await sb
    .from('suspicious_shares')
    .select('id', { count: 'exact', head: true })
    .eq('stream_id', access.streamId)
    .is('revoked_at', null)
    .gt('expires_at', new Date(now).toISOString());
  if (countErr) {
    console.error('suspicious-log: share count failed:', countErr.message);
    return reply({ error: 'could not create the link' }, 500);
  }
  if ((active ?? 0) >= MAX_ACTIVE_SHARES) {
    return reply({ error: 'too many active links; revoke some first' }, 409);
  }

  // Only entries that really belong to this channel can go into a link, whatever
  // ids the request names.
  let label: string;
  let messageIds: string[] = [];
  let chatterId: string | null = null;
  if (request.kind === 'chatter') {
    const { data, error } = await sb
      .from('suspicious_messages')
      .select('chatter_name')
      .eq('stream_id', access.streamId)
      .eq('chatter_user_id', request.chatterId)
      .order('sent_at', { ascending: false })
      .limit(1);
    if (error) {
      console.error('suspicious-log: share lookup failed:', error.message);
      return reply({ error: 'could not create the link' }, 500);
    }
    if (!data?.[0]) return reply({ error: 'nothing to share' }, 404);
    label = data[0].chatter_name;
    chatterId = request.chatterId;
  } else {
    const found: { id: string; chatter_user_id: string; chatter_name: string }[] = [];
    for (const ids of chunk(request.messageIds)) {
      const { data, error } = await sb
        .from('suspicious_messages')
        .select('id, chatter_user_id, chatter_name')
        .eq('stream_id', access.streamId)
        .in('id', ids);
      if (error) {
        console.error('suspicious-log: share lookup failed:', error.message);
        return reply({ error: 'could not create the link' }, 500);
      }
      found.push(...(data ?? []));
    }
    if (found.length === 0) return reply({ error: 'nothing to share' }, 404);
    messageIds = found.map((m) => m.id);
    label = new Set(found.map((m) => m.chatter_user_id)).size === 1 ? found[0].chatter_name : 'Selected messages';
  }

  const token = newShareToken();
  const expiresAt = shareExpiry(now);
  const { data: created, error: insertErr } = await sb
    .from('suspicious_shares')
    .insert({
      stream_id: access.streamId,
      token,
      kind: request.kind,
      message_ids: messageIds,
      chatter_user_id: chatterId,
      label,
      created_by_id: access.userId,
      created_by_login: access.userLogin,
      expires_at: expiresAt,
    })
    .select('id')
    .single();
  if (insertErr || !created) {
    console.error('suspicious-log: share insert failed:', insertErr?.message);
    return reply({ error: 'could not create the link' }, 500);
  }

  return reply(
    { share: { id: created.id, url: shareUrl(req, token), kind: request.kind, label, expiresAt } },
    201,
  );
}

// The channel's links. The streamer sees every one; a mod sees only their own,
// because a link's URL is the credential and isn't theirs to read.
export async function GET(req: NextRequest) {
  const access = await getSuspiciousLogAccess();
  if (!access.ok) return denied(access.reason);

  let query = supabaseAdmin()
    .from('suspicious_shares')
    .select('id, token, kind, label, created_by_id, created_by_login, created_at, expires_at, revoked_at')
    .eq('stream_id', access.streamId);
  if (access.role !== 'streamer') query = query.eq('created_by_id', access.userId);

  const { data, error } = await query.order('created_at', { ascending: false }).limit(LIST_LIMIT);
  if (error) {
    console.error('suspicious-log: share list failed:', error.message);
    return reply({ error: 'could not load links' }, 500);
  }

  const now = Date.now();
  const shares: ShareSummary[] = (data ?? []).map((row) => {
    const status = shareStatus(row, now);
    return {
      id: row.id,
      // A dead link's URL is withheld: there is nothing left to copy.
      url: status === 'active' ? shareUrl(req, row.token) : null,
      kind: row.kind,
      label: row.label,
      created_by_login: row.created_by_login,
      created_at: row.created_at,
      expires_at: row.expires_at,
      status,
      mine: row.created_by_id === access.userId,
    };
  });
  return reply({ shares } satisfies SharesResponse);
}

// Revokes a link: it stops working at once. The streamer can revoke any; a mod
// only their own.
export async function DELETE(req: NextRequest) {
  const access = await getSuspiciousLogAccess();
  if (!access.ok) return denied(access.reason);

  const body = await req.json().catch(() => ({}));
  const id = typeof body.id === 'string' && UUID.test(body.id) ? body.id : '';
  if (!id) return reply({ error: 'invalid id' }, 400);

  let query = supabaseAdmin()
    .from('suspicious_shares')
    .update({ revoked_at: new Date().toISOString() })
    .eq('id', id)
    .eq('stream_id', access.streamId)
    .is('revoked_at', null);
  if (access.role !== 'streamer') query = query.eq('created_by_id', access.userId);

  const { data, error } = await query.select('id');
  if (error) {
    console.error('suspicious-log: revoke failed:', error.message);
    return reply({ error: 'could not revoke the link' }, 500);
  }
  if (!data?.length) return reply({ error: 'not found' }, 404);
  return reply({ ok: true });
}

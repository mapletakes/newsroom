import { NextRequest } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { getSuspiciousLogAccess, type LogAccess } from '@/lib/suspicious-log-access';
import { denied, reply } from '@/lib/suspicious-log-http';
import { checkRateLimit, hashKey } from '@/lib/ratelimit';
import { MAX_FLAG_MESSAGES, type ChannelFlag, type FlagMessage, type FlagsResponse } from '@/lib/chatter-flag-types';
import {
  CONTEXT_REQUIRED,
  flagExpiry,
  flagStatus,
  loadChannelMessages,
  lookupTwitchUser,
  parseCreateFlag,
  parseUpdateFlag,
} from '@/lib/chatter-flags';

export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const LIST_LIMIT = 100;

type Granted = Extract<LogAccess, { ok: true }>;

const FLAG_COLUMNS =
  'id, chatter_user_id, chatter_login, chatter_name, category, context, created_by_id, created_by_login, created_at, updated_at, withdrawn_at, expires_at';

type FlagRow = {
  id: string;
  chatter_user_id: string;
  chatter_login: string;
  chatter_name: string;
  category: ChannelFlag['category'];
  context: string;
  created_by_id: string;
  created_by_login: string;
  created_at: string;
  updated_at: string | null;
  withdrawn_at: string | null;
  expires_at: string;
};

const canEdit = (access: Granted, flag: { created_by_id: string }) =>
  access.role === 'streamer' || flag.created_by_id === access.userId;

// Flagging adds to what other channels will review, so it needs the module to
// be on, not just a streamer who can still read an old log.
const flaggingOff = () => reply({ error: 'The suspicious log is turned off for this channel.' }, 403);

/** This channel's live flag on a chatter, if any. */
async function liveFlagFor(sb: ReturnType<typeof supabaseAdmin>, streamId: string, chatterId: string) {
  return sb
    .from('chatter_flags')
    .select('id')
    .eq('stream_id', streamId)
    .eq('chatter_user_id', chatterId)
    .is('withdrawn_at', null)
    .is('removed_at', null)
    .maybeSingle();
}

// This channel's flags, newest first, with the log entries each one points at.
// Everyone on the channel's team sees all of them, including who made each:
// that stays inside the channel. `?chatterId=` narrows to one chatter's live
// flag, which the flag dialog checks before offering to make a new one.
export async function GET(req: NextRequest) {
  const access = await getSuspiciousLogAccess();
  if (!access.ok) return denied(access.reason);

  const chatterId = req.nextUrl.searchParams.get('chatterId') ?? '';
  if (chatterId && !/^\d{1,20}$/.test(chatterId)) return reply({ error: 'invalid chatterId' }, 400);

  let query = supabaseAdmin()
    .from('chatter_flags')
    .select(`${FLAG_COLUMNS}, chatter_flag_messages(suspicious_messages(id, sent_at, message_text, low_trust_status))`)
    .eq('stream_id', access.streamId)
    .is('removed_at', null);
  if (chatterId) query = query.eq('chatter_user_id', chatterId).is('withdrawn_at', null);

  const { data, error } = await query.order('created_at', { ascending: false }).limit(LIST_LIMIT);
  if (error) {
    console.error('chatter-flags: list failed:', error.message);
    return reply({ error: 'could not load flags' }, 500);
  }

  const now = Date.now();
  type Row = FlagRow & { chatter_flag_messages?: { suspicious_messages: FlagMessage | null }[] | null };
  // supabase-js types every embed as an array without generated types; a
  // many-to-one embed like suspicious_messages actually arrives as one object.
  const flags: ChannelFlag[] = ((data ?? []) as unknown as Row[])
    .map((row) => ({
      id: row.id,
      chatter_user_id: row.chatter_user_id,
      chatter_login: row.chatter_login,
      chatter_name: row.chatter_name,
      category: row.category,
      context: row.context,
      created_by_login: row.created_by_login,
      created_at: row.created_at,
      updated_at: row.updated_at,
      expires_at: row.expires_at,
      status: flagStatus(row, now),
      mine: row.created_by_id === access.userId,
      canEdit: canEdit(access, row),
      messages: (row.chatter_flag_messages ?? [])
        .map((link) => link.suspicious_messages)
        .filter((m): m is FlagMessage => !!m)
        .sort((a, b) => Date.parse(a.sent_at) - Date.parse(b.sent_at)),
    }))
    .filter((flag) => !chatterId || flag.status === 'active');
  return reply({ flags } satisfies FlagsResponse);
}

// Flags a chatter. Streamer and current mods, while the module is on. A chatter
// this channel has already flagged gets added to instead (PATCH), so the network
// sees one flag per channel, not one per mod.
export async function POST(req: NextRequest) {
  const access = await getSuspiciousLogAccess();
  if (!access.ok) return denied(access.reason);
  if (!access.logEnabled) return flaggingOff();

  const parsed = parseCreateFlag(await req.json().catch(() => null));
  if (!parsed.ok) return reply({ error: parsed.error }, 400);
  const request = parsed.value;
  const { target } = request;

  const limited = await checkRateLimit('flag', hashKey(`${access.streamId}:${access.userId}`));
  if (!limited.ok) return reply({ error: 'You’re flagging too fast. Try again in a few minutes.' }, 429);

  const sb = supabaseAdmin();
  const now = Date.now();

  // Who is being flagged, and which of this channel's log entries back it up.
  let chatter: { id: string; login: string; name: string };
  let messageIds: string[] = [];
  try {
    if (target.kind === 'login') {
      const user = await lookupTwitchUser(target.login);
      if (!user) return reply({ error: 'There’s no Twitch account with that username.' }, 404);
      chatter = { id: user.id, login: user.login, name: user.display_name };
    } else if (request.messageIds.length > 0) {
      const found = await loadChannelMessages(sb, access.streamId, request.messageIds);
      if (found.length === 0) return reply({ error: 'Those messages aren’t in this channel’s log.' }, 404);
      if (found.some((m) => m.chatter_user_id !== target.chatterId)) {
        return reply({ error: 'Every message in a flag has to be from the chatter being flagged.' }, 400);
      }
      chatter = { id: found[0].chatter_user_id, login: found[0].chatter_login, name: found[0].chatter_name };
      messageIds = found.map((m) => m.id);
    } else {
      const { data, error } = await sb
        .from('suspicious_messages')
        .select('chatter_login, chatter_name')
        .eq('stream_id', access.streamId)
        .eq('chatter_user_id', target.chatterId)
        .order('sent_at', { ascending: false })
        .limit(1);
      if (error) throw new Error(error.message);
      if (!data?.[0]) return reply({ error: 'That chatter isn’t in this channel’s log.' }, 404);
      chatter = { id: target.chatterId, login: data[0].chatter_login, name: data[0].chatter_name };
    }
  } catch (err) {
    console.error('chatter-flags: resolving the chatter failed:', err);
    return reply({ error: 'could not create the flag' }, 502);
  }

  // An expired flag is as good as gone, but would still hold this chatter's
  // one live slot until the nightly cleanup deletes it.
  await sb
    .from('chatter_flags')
    .delete()
    .eq('stream_id', access.streamId)
    .eq('chatter_user_id', chatter.id)
    .lt('expires_at', new Date(now).toISOString());

  const existing = await liveFlagFor(sb, access.streamId, chatter.id);
  if (existing.error) {
    console.error('chatter-flags: lookup failed:', existing.error.message);
    return reply({ error: 'could not create the flag' }, 500);
  }
  if (existing.data) {
    return reply({ error: 'This channel has already flagged that chatter.', flagId: existing.data.id }, 409);
  }

  const { data: created, error: insertErr } = await sb
    .from('chatter_flags')
    .insert({
      stream_id: access.streamId,
      chatter_user_id: chatter.id,
      chatter_login: chatter.login,
      chatter_name: chatter.name,
      category: request.category,
      context: request.context,
      created_by_id: access.userId,
      created_by_login: access.userLogin,
      expires_at: flagExpiry(now),
    })
    .select('id')
    .single();
  if (insertErr?.code === '23505') {
    // Another mod flagged them in the same moment.
    const raced = await liveFlagFor(sb, access.streamId, chatter.id);
    return reply({ error: 'This channel has already flagged that chatter.', flagId: raced.data?.id }, 409);
  }
  if (insertErr || !created) {
    console.error('chatter-flags: insert failed:', insertErr?.message);
    return reply({ error: 'could not create the flag' }, 500);
  }

  if (messageIds.length > 0) {
    const { error: linkErr } = await sb
      .from('chatter_flag_messages')
      .insert(messageIds.map((message_id) => ({ flag_id: created.id, message_id })));
    if (linkErr) {
      // No half-made flags: one that should carry evidence but doesn't would
      // read to other channels as a bare accusation.
      console.error('chatter-flags: message links failed:', linkErr.message);
      await sb.from('chatter_flags').delete().eq('id', created.id);
      return reply({ error: 'could not create the flag' }, 500);
    }
  }

  return reply({ flag: { id: created.id, chatterName: chatter.name } }, 201);
}

// Changes a live flag. Anyone on the team can add log entries to it, since
// evidence is evidence; only the streamer or whoever made it can change what it
// says.
export async function PATCH(req: NextRequest) {
  const access = await getSuspiciousLogAccess();
  if (!access.ok) return denied(access.reason);
  if (!access.logEnabled) return flaggingOff();

  const parsed = parseUpdateFlag(await req.json().catch(() => null));
  if (!parsed.ok) return reply({ error: parsed.error }, 400);
  const request = parsed.value;

  const sb = supabaseAdmin();
  const now = Date.now();
  const { data: flag, error: flagErr } = await sb
    .from('chatter_flags')
    .select('id, chatter_user_id, context, created_by_id, withdrawn_at, expires_at')
    .eq('id', request.id)
    .eq('stream_id', access.streamId)
    .is('removed_at', null)
    .maybeSingle();
  if (flagErr) {
    console.error('chatter-flags: lookup failed:', flagErr.message);
    return reply({ error: 'could not update the flag' }, 500);
  }
  if (!flag || flagStatus(flag, now) !== 'active') return reply({ error: 'not found' }, 404);

  const rewording = request.category !== undefined || request.context !== undefined;
  if (rewording && !canEdit(access, flag)) {
    return reply({ error: 'Only the streamer or whoever made this flag can change it.' }, 403);
  }

  const { count: linked, error: countErr } = await sb
    .from('chatter_flag_messages')
    .select('message_id', { count: 'exact', head: true })
    .eq('flag_id', flag.id);
  if (countErr) {
    console.error('chatter-flags: count failed:', countErr.message);
    return reply({ error: 'could not update the flag' }, 500);
  }

  let addIds: string[] = [];
  if (request.addMessageIds.length > 0) {
    let found;
    try {
      found = await loadChannelMessages(sb, access.streamId, request.addMessageIds);
    } catch (err) {
      console.error('chatter-flags:', err);
      return reply({ error: 'could not update the flag' }, 500);
    }
    if (found.length === 0) return reply({ error: 'Those messages aren’t in this channel’s log.' }, 404);
    if (found.some((m) => m.chatter_user_id !== flag.chatter_user_id)) {
      return reply({ error: 'Every message in a flag has to be from the chatter being flagged.' }, 400);
    }
    addIds = found.map((m) => m.id);
    if ((linked ?? 0) + addIds.length > MAX_FLAG_MESSAGES) {
      return reply({ error: `A flag can hold at most ${MAX_FLAG_MESSAGES} messages.` }, 400);
    }
  }

  const context = request.context ?? flag.context;
  if (context === '' && (linked ?? 0) + addIds.length === 0) return reply({ error: CONTEXT_REQUIRED }, 400);

  if (addIds.length > 0) {
    const { error } = await sb
      .from('chatter_flag_messages')
      .upsert(
        addIds.map((message_id) => ({ flag_id: flag.id, message_id })),
        { onConflict: 'flag_id,message_id', ignoreDuplicates: true },
      );
    if (error) {
      console.error('chatter-flags: adding messages failed:', error.message);
      return reply({ error: 'could not update the flag' }, 500);
    }
  }

  const patch: Record<string, unknown> = { updated_at: new Date(now).toISOString() };
  if (request.category !== undefined) patch.category = request.category;
  if (request.context !== undefined) patch.context = request.context;
  const { error: updateErr } = await sb.from('chatter_flags').update(patch).eq('id', flag.id);
  if (updateErr) {
    console.error('chatter-flags: update failed:', updateErr.message);
    return reply({ error: 'could not update the flag' }, 500);
  }
  return reply({ ok: true, added: addIds.length });
}

// Withdraws a flag: other channels stop seeing it. The streamer can withdraw
// any, a mod only their own. Allowed with the module off, so a streamer can
// still take back what their channel said.
export async function DELETE(req: NextRequest) {
  const access = await getSuspiciousLogAccess();
  if (!access.ok) return denied(access.reason);

  const body = await req.json().catch(() => ({}));
  const id = typeof body?.id === 'string' && UUID.test(body.id) ? body.id : '';
  if (!id) return reply({ error: 'invalid id' }, 400);

  let query = supabaseAdmin()
    .from('chatter_flags')
    .update({ withdrawn_at: new Date().toISOString() })
    .eq('id', id)
    .eq('stream_id', access.streamId)
    .is('withdrawn_at', null)
    .is('removed_at', null);
  if (access.role !== 'streamer') query = query.eq('created_by_id', access.userId);

  const { data, error } = await query.select('id');
  if (error) {
    console.error('chatter-flags: withdraw failed:', error.message);
    return reply({ error: 'could not withdraw the flag' }, 500);
  }
  if (!data?.length) return reply({ error: 'not found' }, 404);
  return reply({ ok: true });
}

import { NextRequest } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { getSuspiciousLogAccess, type LogAccess } from '@/lib/suspicious-log-access';
import { denied, reply } from '@/lib/suspicious-log-http';
import { isReviewDecision } from '@/lib/chatter-flag-types';

export const dynamic = 'force-dynamic';

const TWITCH_ID = /^\d{1,20}$/;

type Granted = Extract<LogAccess, { ok: true }>;

/** Null when this channel may record decisions, else the refusal to send. */
async function refuseUnlessReceiving(access: Granted) {
  if (!access.logEnabled) return reply({ error: 'The suspicious log is turned off for this channel.' }, 403);
  const { data, error } = await supabaseAdmin()
    .from('streams')
    .select('flag_network_subscribed')
    .eq('id', access.streamId)
    .maybeSingle();
  if (error) {
    console.error('flag-network: channel lookup failed:', error.message);
    return reply({ error: 'could not save the decision' }, 500);
  }
  if (data?.flag_network_subscribed !== true) {
    return reply({ error: 'This channel isn’t receiving network flags.' }, 403);
  }
  return null;
}

// Records what this channel decided about a flagged chatter: banned, watching
// or dismissed. The streamer or any current mod, since mods are the ones who
// usually do the banning. One decision per chatter, replaced by the next.
export async function POST(req: NextRequest) {
  const access = await getSuspiciousLogAccess();
  if (!access.ok) return denied(access.reason);

  const body = await req.json().catch(() => null);
  const chatterId = typeof body?.chatterId === 'string' && TWITCH_ID.test(body.chatterId) ? body.chatterId : '';
  if (!chatterId || !isReviewDecision(body?.decision)) return reply({ error: 'invalid request' }, 400);

  const refused = await refuseUnlessReceiving(access);
  if (refused) return refused;

  const sb = supabaseAdmin();
  // Only chatters another channel has actually flagged, so the table holds
  // decisions about real flags rather than whatever ids a client sends.
  const { count, error: flagErr } = await sb
    .from('chatter_flags')
    .select('id', { count: 'exact', head: true })
    .eq('chatter_user_id', chatterId)
    .neq('stream_id', access.streamId)
    .is('withdrawn_at', null)
    .is('removed_at', null)
    .gt('expires_at', new Date().toISOString());
  if (flagErr) {
    console.error('flag-network: flag check failed:', flagErr.message);
    return reply({ error: 'could not save the decision' }, 500);
  }
  if (!count) return reply({ error: 'No channel has a live flag on that chatter.' }, 404);

  const decidedAt = new Date().toISOString();
  const { error } = await sb.from('chatter_flag_reviews').upsert(
    {
      stream_id: access.streamId,
      chatter_user_id: chatterId,
      decision: body.decision,
      decided_by_id: access.userId,
      decided_by_login: access.userLogin,
      decided_at: decidedAt,
    },
    { onConflict: 'stream_id,chatter_user_id' },
  );
  if (error) {
    console.error('flag-network: review save failed:', error.message);
    return reply({ error: 'could not save the decision' }, 500);
  }
  return reply({ ok: true, decision: body.decision, decidedAt });
}

// Clears a decision, putting the chatter back among the new ones.
export async function DELETE(req: NextRequest) {
  const access = await getSuspiciousLogAccess();
  if (!access.ok) return denied(access.reason);

  const body = await req.json().catch(() => null);
  const chatterId = typeof body?.chatterId === 'string' && TWITCH_ID.test(body.chatterId) ? body.chatterId : '';
  if (!chatterId) return reply({ error: 'invalid request' }, 400);

  const refused = await refuseUnlessReceiving(access);
  if (refused) return refused;

  const { error } = await supabaseAdmin()
    .from('chatter_flag_reviews')
    .delete()
    .eq('stream_id', access.streamId)
    .eq('chatter_user_id', chatterId);
  if (error) {
    console.error('flag-network: review clear failed:', error.message);
    return reply({ error: 'could not clear the decision' }, 500);
  }
  return reply({ ok: true });
}

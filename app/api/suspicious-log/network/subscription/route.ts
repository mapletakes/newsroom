import { NextRequest } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { getSuspiciousLogAccess } from '@/lib/suspicious-log-access';
import { denied, reply } from '@/lib/suspicious-log-http';

export const dynamic = 'force-dynamic';

// Turns receiving other channels' flags on or off. The streamer's call alone:
// it changes what their whole mod team sees. Turning it on needs the suspicious
// log module; turning it off never does.
export async function POST(req: NextRequest) {
  const access = await getSuspiciousLogAccess();
  if (!access.ok) return denied(access.reason);
  if (access.role !== 'streamer') {
    return reply({ error: 'Only the streamer can change whether this channel receives flags.' }, 403);
  }

  const body = await req.json().catch(() => null);
  if (typeof body?.subscribed !== 'boolean') return reply({ error: 'invalid request' }, 400);
  const subscribed: boolean = body.subscribed;
  if (subscribed && !access.logEnabled) {
    return reply({ error: 'The suspicious log is turned off for this channel.' }, 403);
  }

  const { error } = await supabaseAdmin()
    .from('streams')
    .update({ flag_network_subscribed: subscribed })
    .eq('id', access.streamId);
  if (error) {
    console.error('flag-network: subscription update failed:', error.message);
    return reply({ error: 'could not save that' }, 500);
  }
  return reply({ ok: true, subscribed });
}

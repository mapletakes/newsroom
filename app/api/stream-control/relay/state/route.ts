import { NextRequest } from 'next/server';
import { broadcastStreamControlChange } from '@/lib/realtime';
import { parseSnapshot } from '@/lib/stream-control';
import { reply, requireRelay } from '@/lib/stream-control-http';
import { supabaseAdmin } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

const EMPTY_SNAPSHOT = { activeSceneId: null, scenes: [] };

// The relay reports in. With a snapshot: Streamlabs changed (or the relay just
// connected), so the stored scene list is replaced and panels are told. Without
// one: a heartbeat, which keeps the relay counted as online and records whether
// it can currently reach Streamlabs. Panels hear about a heartbeat only when
// that connection flipped, not every 30 seconds.
export async function POST(req: NextRequest) {
  const guard = await requireRelay();
  if (!guard.ok) return guard.response;
  const { streamId } = guard.session;

  const body = await req.json().catch(() => null);
  if (!body || typeof body.connected !== 'boolean') return reply({ error: 'missing connected' }, 400);
  const connected: boolean = body.connected;
  const now = new Date().toISOString();
  const sb = supabaseAdmin();

  if (body.snapshot !== undefined) {
    const snapshot = parseSnapshot(body.snapshot);
    if (!snapshot) return reply({ error: 'invalid snapshot' }, 400);
    const { error } = await sb.from('stream_control_state').upsert({
      stream_id: streamId,
      snapshot,
      streamlabs_connected: connected,
      updated_at: now,
      relay_seen_at: now,
    });
    if (error) return reply({ error: error.message }, 500);
    await broadcastStreamControlChange(streamId);
    return reply({ ok: true });
  }

  const { data: existing } = await sb
    .from('stream_control_state')
    .select('streamlabs_connected')
    .eq('stream_id', streamId)
    .maybeSingle();
  const { error } = existing
    ? await sb
        .from('stream_control_state')
        .update({ streamlabs_connected: connected, relay_seen_at: now })
        .eq('stream_id', streamId)
    : await sb.from('stream_control_state').insert({
        stream_id: streamId,
        snapshot: EMPTY_SNAPSHOT,
        streamlabs_connected: connected,
        relay_seen_at: now,
      });
  if (error) return reply({ error: error.message }, 500);
  if (existing?.streamlabs_connected !== connected) await broadcastStreamControlChange(streamId);
  return reply({ ok: true });
}

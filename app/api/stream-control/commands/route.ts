import { NextRequest } from 'next/server';
import { checkRateLimit, hashKey } from '@/lib/ratelimit';
import { broadcastStreamControlChange, broadcastStreamControlCommand } from '@/lib/realtime';
import { sessionLogin } from '@/lib/session';
import {
  COMMAND_COLUMNS,
  accessAllows,
  isRelayOnline,
  parseCommand,
  parseSnapshot,
  toControlRecord,
} from '@/lib/stream-control';
import { reply, requireStreamControl } from '@/lib/stream-control-http';
import { supabaseAdmin } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

const LOG_LIMIT = 100;

// The streamer's record of what was done through stream control, newest first.
export async function GET() {
  const guard = await requireStreamControl();
  if (!guard.ok) return guard.response;
  if (guard.session.role !== 'streamer') return reply({ error: 'forbidden' }, 403);

  const { data, error } = await supabaseAdmin()
    .from('stream_control_commands')
    .select(COMMAND_COLUMNS)
    .eq('stream_id', guard.session.streamId)
    .order('created_at', { ascending: false })
    .limit(LOG_LIMIT);
  if (error) return reply({ error: error.message }, 500);
  return reply({ commands: (data ?? []).map(toControlRecord) });
}

// Queue a scene switch or a show/hide for the relay. Checked here, in order:
// the person's grant, their rate limit, that the relay is there to run it (a
// command it can't run would only expire, and the person deserves to know
// now), and that the target is something the relay last reported. Sources can
// only be toggled in the live scene: that's what the panel offers, and a
// toggle aimed at a scene that has just been switched away from is almost
// certainly a stale click.
export async function POST(req: NextRequest) {
  const guard = await requireStreamControl();
  if (!guard.ok) return guard.response;
  const { session, access } = guard;

  const command = parseCommand(await req.json().catch(() => null));
  if (!command) return reply({ error: 'invalid command' }, 400);
  if (!accessAllows(access, command.kind)) return reply({ error: 'forbidden' }, 403);

  const limit = await checkRateLimit('control', hashKey(`${session.streamId}:${session.accountId}`));
  if (!limit.ok) {
    return reply({ error: 'rate-limited', retryAfterSeconds: limit.retryAfterSeconds }, 429);
  }

  const sb = supabaseAdmin();
  const { data: state, error: stateErr } = await sb
    .from('stream_control_state')
    .select('snapshot, streamlabs_connected, relay_seen_at')
    .eq('stream_id', session.streamId)
    .maybeSingle();
  if (stateErr) return reply({ error: stateErr.message }, 500);
  if (!isRelayOnline(state?.relay_seen_at)) return reply({ error: 'relay-offline' }, 409);
  if (state?.streamlabs_connected !== true) return reply({ error: 'streamlabs-disconnected' }, 409);

  const snapshot = parseSnapshot(state.snapshot);
  const scene = snapshot?.scenes.find((s) => s.id === command.args.sceneId);
  if (!snapshot || !scene) return reply({ error: 'unknown-scene' }, 404);
  let targetName = scene.name;
  if (command.kind === 'set_visibility') {
    if (scene.id !== snapshot.activeSceneId) return reply({ error: 'not-live-scene' }, 409);
    const item = scene.items.find((i) => i.id === command.args.itemId);
    if (!item || item.type !== 'item') return reply({ error: 'unknown-source' }, 404);
    targetName = item.name;
  }

  const { data: row, error } = await sb
    .from('stream_control_commands')
    .insert({
      stream_id: session.streamId,
      kind: command.kind,
      args: command.args,
      actor_account_id: session.accountId,
      actor_login: sessionLogin(session),
      target_name: targetName || null,
    })
    .select(COMMAND_COLUMNS)
    .single();
  if (error || !row) return reply({ error: error?.message ?? 'insert failed' }, 500);

  await Promise.all([broadcastStreamControlCommand(session.streamId), broadcastStreamControlChange(session.streamId)]);
  return reply({ command: toControlRecord(row) }, 201);
}

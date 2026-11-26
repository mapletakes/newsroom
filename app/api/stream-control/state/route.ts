import {
  COMMAND_COLUMNS,
  isRelayOnline,
  parseSnapshot,
  toControlRecord,
  type ControlView,
} from '@/lib/stream-control';
import { reply, requireStreamControl } from '@/lib/stream-control-http';
import { supabaseAdmin } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

const RECENT_LIMIT = 15;
const EMPTY = { activeSceneId: null, scenes: [] };

// What a control panel shows: the scene list as the relay last reported it,
// whether the relay is there to act on anything, what this person may do, and
// the last few commands so they can see theirs land (or not).
export async function GET() {
  const guard = await requireStreamControl();
  if (!guard.ok) return guard.response;
  const { session, access } = guard;
  if (!access.canSwitchScenes && !access.canToggleSources) return reply({ error: 'forbidden' }, 403);

  const sb = supabaseAdmin();
  const [{ data: state, error: stateErr }, { data: rows, error: rowsErr }] = await Promise.all([
    sb
      .from('stream_control_state')
      .select('snapshot, streamlabs_connected, updated_at, relay_seen_at')
      .eq('stream_id', session.streamId)
      .maybeSingle(),
    sb
      .from('stream_control_commands')
      .select(COMMAND_COLUMNS)
      .eq('stream_id', session.streamId)
      .order('created_at', { ascending: false })
      .limit(RECENT_LIMIT),
  ]);
  if (stateErr) return reply({ error: stateErr.message }, 500);
  if (rowsErr) return reply({ error: rowsErr.message }, 500);

  const relayOnline = isRelayOnline(state?.relay_seen_at);
  const view: ControlView = {
    snapshot: parseSnapshot(state?.snapshot) ?? EMPTY,
    relayOnline,
    streamlabsConnected: relayOnline && state?.streamlabs_connected === true,
    updatedAt: state?.updated_at ?? null,
    access: { canSwitchScenes: access.canSwitchScenes, canToggleSources: access.canToggleSources },
    recent: (rows ?? []).map(toControlRecord),
  };
  return reply(view);
}

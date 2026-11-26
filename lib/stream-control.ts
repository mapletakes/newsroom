import { supabaseAdmin } from './supabase';
import type { Session } from './session';
import { checkCurrentMod } from './suspicious-log-access';
import type { ControlCommandKind } from './stream-control-shared';

export * from './stream-control-shared';

// Stream control: permitted mods switch the streamer's Streamlabs scenes and
// show/hide sources. See supabase/migrations/20261126120000_add_stream_control.sql
// for the shape of it — the short version is that a relay page on the
// streamer's PC is the only thing that ever talks to Streamlabs, and this file
// is everything the server needs to decide what reaches that relay.

// ---------------------------------------------------------------------------
// Access.

export type StreamControlAccess = {
  /** The module switch for this channel. */
  enabled: boolean;
  canSwitchScenes: boolean;
  canToggleSources: boolean;
  /** Only the streamer runs the relay: it's their PC and their token. */
  canRunRelay: boolean;
};

const NO_ACCESS: StreamControlAccess = {
  enabled: false,
  canSwitchScenes: false,
  canToggleSources: false,
  canRunRelay: false,
};

/** What this session may do with stream control. The streamer has everything
 *  while the module is on; a mod has only what the streamer granted them. With
 *  the module off, nobody has anything. */
export async function getStreamControlAccess(session: Session): Promise<StreamControlAccess> {
  const sb = supabaseAdmin();
  const { data: stream } = await sb
    .from('streams')
    .select('stream_control_enabled, twitch_user_id')
    .eq('id', session.streamId)
    .maybeSingle();
  if (stream?.stream_control_enabled !== true) return NO_ACCESS;

  if (session.role === 'streamer') {
    return { enabled: true, canSwitchScenes: true, canToggleSources: true, canRunRelay: true };
  }
  const none = { ...NO_ACCESS, enabled: true };
  if (!session.twitchUserId || !stream.twitch_user_id) return none;
  const { data: mod } = await sb
    .from('moderators')
    .select('can_switch_scenes, can_toggle_sources')
    .eq('stream_id', session.streamId)
    .eq('twitch_user_id', session.twitchUserId)
    .maybeSingle();
  const canSwitchScenes = mod?.can_switch_scenes === true;
  const canToggleSources = mod?.can_toggle_sources === true;
  if (!canSwitchScenes && !canToggleSources) return none;

  // Grants outlive mod status: rows in moderators are never removed and a
  // mod's cookie lasts 30 days. Someone the streamer has since unmodded must
  // not keep control of their scenes, so ask Twitch (cached for a few
  // minutes) — and any doubt, including Twitch being down, denies.
  if ((await checkCurrentMod(session.twitchUserId, stream.twitch_user_id)) !== true) return none;

  return { enabled: true, canSwitchScenes, canToggleSources, canRunRelay: false };
}

/** Whether `access` covers this kind of command. */
export function accessAllows(access: StreamControlAccess, kind: ControlCommandKind): boolean {
  return kind === 'switch_scene' ? access.canSwitchScenes : access.canToggleSources;
}


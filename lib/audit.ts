import type { supabaseAdmin } from './supabase';

/**
 * Records a super-admin write to admin_actions. Fire-and-forget by design —
 * an audit log that could fail the action it's auditing (a flag toggle an
 * admin is waiting on) would be worse than an occasional missed row, so
 * callers await it for ordering but don't fail the request if it errors.
 */
export async function logAdminAction(
  sb: ReturnType<typeof supabaseAdmin>,
  actor: { twitchUserId: string; twitchLogin: string },
  action: string,
  streamId: string | null,
  payload?: Record<string, unknown>,
): Promise<void> {
  try {
    await sb.from('admin_actions').insert({
      actor_twitch_user_id: actor.twitchUserId,
      actor_login: actor.twitchLogin,
      action,
      stream_id: streamId,
      payload: payload ?? null,
    });
  } catch {
    /* audit logging must never break the action it's logging */
  }
}

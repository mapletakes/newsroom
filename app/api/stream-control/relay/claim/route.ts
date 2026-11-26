import { broadcastStreamControlChange } from '@/lib/realtime';
import { COMMAND_TTL_MS } from '@/lib/stream-control';
import { reply, requireRelay } from '@/lib/stream-control-http';
import { supabaseAdmin } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

// The relay picks up queued commands. Two steps, both on the server's clock:
// anything that waited longer than COMMAND_TTL_MS is marked expired instead of
// run, and the rest move pending → running and are handed over. The move is a
// conditional update, so if the streamer has the relay open in two tabs, each
// command still goes to only one of them.
export async function POST() {
  const guard = await requireRelay();
  if (!guard.ok) return guard.response;
  const { streamId } = guard.session;
  const sb = supabaseAdmin();
  const now = new Date();
  const cutoff = new Date(now.getTime() - COMMAND_TTL_MS).toISOString();

  const { data: expired, error: expireErr } = await sb
    .from('stream_control_commands')
    .update({ status: 'expired', finished_at: now.toISOString() })
    .eq('stream_id', streamId)
    .eq('status', 'pending')
    .lt('created_at', cutoff)
    .select('id');
  if (expireErr) return reply({ error: expireErr.message }, 500);

  const { data: claimed, error: claimErr } = await sb
    .from('stream_control_commands')
    .update({ status: 'running' })
    .eq('stream_id', streamId)
    .eq('status', 'pending')
    .gte('created_at', cutoff)
    .select('id, kind, args, actor_login, created_at');
  if (claimErr) return reply({ error: claimErr.message }, 500);

  if ((expired?.length ?? 0) > 0) await broadcastStreamControlChange(streamId);

  const commands = [...(claimed ?? [])].sort((a, b) => a.created_at.localeCompare(b.created_at));
  return reply({ commands });
}

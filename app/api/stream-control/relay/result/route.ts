import { NextRequest } from 'next/server';
import { broadcastStreamControlChange } from '@/lib/realtime';
import { reply, requireRelay } from '@/lib/stream-control-http';
import { supabaseAdmin } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// The relay reports how a claimed command went. Only a running command of this
// stream can be finished, and only once.
export async function POST(req: NextRequest) {
  const guard = await requireRelay();
  if (!guard.ok) return guard.response;
  const { streamId } = guard.session;

  const body = await req.json().catch(() => null);
  const id = typeof body?.id === 'string' ? body.id : '';
  if (!UUID.test(id) || typeof body.ok !== 'boolean') return reply({ error: 'invalid result' }, 400);
  const error = body.ok ? null : String(body.error || 'failed').slice(0, 500);

  const { data, error: dbErr } = await supabaseAdmin()
    .from('stream_control_commands')
    .update({ status: body.ok ? 'done' : 'failed', error, finished_at: new Date().toISOString() })
    .eq('id', id)
    .eq('stream_id', streamId)
    .eq('status', 'running')
    .select('id');
  if (dbErr) return reply({ error: dbErr.message }, 500);
  if (!data || data.length === 0) return reply({ error: 'not found' }, 404);

  await broadcastStreamControlChange(streamId);
  return reply({ ok: true });
}

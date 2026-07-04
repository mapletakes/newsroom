// Server-side Realtime broadcast.
// Fires a lightweight "queue changed" ping so open deck/mod views can
// refetch on demand instead of polling on a timer. Uses Supabase's HTTP
// broadcast endpoint — no persistent connection, works fine on Vercel.
//
// The payload carries NO submission data — just a nudge. Clients react by
// refetching through the authenticated /api/queue endpoint, so nothing
// sensitive rides the (anon-subscribable) websocket.

export async function broadcastQueueChange(streamId: string): Promise<void> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key || !streamId) {
    console.warn('broadcastQueueChange: missing url/key/streamId, skipping broadcast');
    return;
  }

  try {
    const r = await fetch(`${url.replace(/\/+$/, '')}/realtime/v1/api/broadcast`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: key,
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({
        messages: [
          {
            topic: `queue:${streamId}`,
            event: 'changed',
            payload: { at: Date.now() },
          },
        ],
      }),
    });
    // fetch() only rejects on network failure, not on HTTP error status — a
    // non-2xx response here (auth issue, wrong project config, etc.) would
    // otherwise fail completely silently and every realtime consumer in the
    // app (deck, mod view, overlay) would be running on its poll fallback
    // alone with no way to tell. Supabase's broadcast endpoint returns 202
    // on success (accepted for async delivery), not 200.
    if (!r.ok) {
      const body = await r.text().catch(() => '');
      console.error(`broadcastQueueChange: POST failed ${r.status} for queue:${streamId} — ${body}`);
    }
  } catch (err) {
    console.error('broadcastQueueChange failed:', err);
  }
}

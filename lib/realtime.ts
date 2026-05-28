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
  if (!url || !key || !streamId) return;

  try {
    await fetch(`${url.replace(/\/+$/, '')}/realtime/v1/api/broadcast`, {
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
  } catch (err) {
    console.error('broadcastQueueChange failed:', err);
  }
}

// Server-side Realtime broadcast.
// Fires a lightweight "changed" ping so open deck/mod/questions views can
// refetch on demand instead of polling on a timer. Uses Supabase's HTTP
// broadcast endpoint — no persistent connection, works fine on Vercel.
//
// The payload carries NO row data — just a nudge. Clients react by
// refetching through the authenticated REST endpoint, so nothing sensitive
// rides the (anon-subscribable) websocket.

async function broadcastChange(topic: string, streamId: string): Promise<void> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key || !streamId) {
    console.warn(`broadcastChange(${topic}): missing url/key/streamId, skipping broadcast`);
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
            topic,
            event: 'changed',
            payload: { at: Date.now() },
          },
        ],
      }),
    });
    // fetch() only rejects on network failure, not on HTTP error status — a
    // non-2xx response here (auth issue, wrong project config, etc.) would
    // otherwise fail completely silently and every realtime consumer in the
    // app (deck, mod view, overlay, questions) would be running on its poll
    // fallback alone with no way to tell. Supabase's broadcast endpoint
    // returns 202 on success (accepted for async delivery), not 200.
    if (!r.ok) {
      const body = await r.text().catch(() => '');
      console.error(`broadcastChange: POST failed ${r.status} for ${topic} — ${body}`);
    }
  } catch (err) {
    console.error(`broadcastChange(${topic}) failed:`, err);
  }
}

/** Pings `queue:${streamId}` — the deck, mod view, and overlay all refetch. */
export function broadcastQueueChange(streamId: string): Promise<void> {
  return broadcastChange(`queue:${streamId}`, streamId);
}

/** Pings `questions:${streamId}` — the questions page and the deck's
 *  questions panel both refetch. Separate from broadcastQueueChange so a
 *  fast-moving Q&A segment doesn't trigger a submissions refetch on every
 *  incoming question. */
export function broadcastQuestionsChange(streamId: string): Promise<void> {
  return broadcastChange(`questions:${streamId}`, streamId);
}

/** Pings `mod-status:${streamId}` — the mod roster on both the mod view and
 *  the deck rail. Its own topic for the same reason as questions: a mod
 *  flipping to "back in 20" shouldn't make every open deck refetch the
 *  submissions queue. */
export function broadcastModStatusChange(streamId: string): Promise<void> {
  return broadcastChange(`mod-status:${streamId}`, streamId);
}

/** Pings `raffle:${streamId}` — the deck's raffle panel refetches. Its own
 *  topic for the same reason as questions and mod-status: entries arriving
 *  during a live raffle would otherwise trigger a refetch of the whole
 *  submissions queue on every single !enter. */
export function broadcastRaffleChange(streamId: string): Promise<void> {
  return broadcastChange(`raffle:${streamId}`, streamId);
}

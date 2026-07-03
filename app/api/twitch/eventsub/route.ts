// Twitch EventSub webhook handler.
// Twitch POSTs chat messages here — no persistent connection needed.

import { NextRequest, NextResponse } from 'next/server';
import { waitUntil } from '@vercel/functions';
import { verifySignature, isTimestampFresh } from '@/lib/twitch-eventsub';
import { supabaseAdmin } from '@/lib/supabase';
import { extractUrlsFromMessage } from '@/lib/url';
import { submitUrlToQueue } from '@/lib/submit-url';

export const maxDuration = 30;

// Twitch EventSub message types
const VERIFICATION = 'webhook_callback_verification';
const NOTIFICATION = 'notification';
const REVOCATION = 'revocation';

export async function POST(req: NextRequest) {
  const rawBody = await req.text();
  const msgId = req.headers.get('twitch-eventsub-message-id') || '';
  const msgTs = req.headers.get('twitch-eventsub-message-timestamp') || '';
  const msgSig = req.headers.get('twitch-eventsub-message-signature') || '';
  const msgType = req.headers.get('twitch-eventsub-message-type') || '';

  console.log('EventSub webhook hit:', { msgType, msgId, hasBody: rawBody.length > 0 });

  // ── Verify signature ──────────────────────────────────────────
  if (!verifySignature(msgId, msgTs, rawBody, msgSig)) {
    console.error('EventSub signature verification FAILED');
    return new NextResponse('invalid signature', { status: 403 });
  }
  if (!isTimestampFresh(msgTs)) {
    console.error('EventSub stale timestamp:', msgTs);
    return new NextResponse('stale timestamp', { status: 403 });
  }

  const body = JSON.parse(rawBody);

  // ── Verification challenge (subscription creation handshake) ──
  if (msgType === VERIFICATION) {
    console.log('EventSub verification challenge received, responding with challenge');
    return new NextResponse(body.challenge, {
      status: 200,
      headers: { 'Content-Type': 'text/plain' },
    });
  }

  // ── Revocation (Twitch killed our subscription) ───────────────
  if (msgType === REVOCATION) {
    console.warn(
      'EventSub revoked:',
      body.subscription?.id,
      body.subscription?.status,
    );
    return new NextResponse(null, { status: 204 });
  }

  // ── Chat message notification ─────────────────────────────────
  if (msgType !== NOTIFICATION) {
    return new NextResponse(null, { status: 204 });
  }

  const event = body.event;
  if (!event) return new NextResponse(null, { status: 204 });

  const sb = supabaseAdmin();

  // Idempotency: ingest each chat message exactly once, even if Twitch retries
  // the webhook (slow handler) or a duplicate subscription delivers it again.
  // event.message_id is stable across every delivery of the same chat message,
  // so it dedups both cases while leaving allow_duplicates (separate messages
  // posting the same URL) intact.
  const eventId: string = event.message_id || msgId;
  if (eventId) {
    const { error: seenErr } = await sb.from('processed_events').insert({ id: eventId });
    if (seenErr) {
      // 23505 = unique violation = already handled this message → drop it.
      if (seenErr.code === '23505') return new NextResponse(null, { status: 204 });
      // Any other error (e.g. table not migrated yet) must not block ingestion.
      console.warn('processed_events insert failed (run migration?):', seenErr.message);
    }
  }

  const broadcasterUserId = event.broadcaster_user_id;
  const chatterName = event.chatter_user_name || event.chatter_user_login || 'anon';
  const messageText = event.message?.text || '';

  // Look up stream
  const { data: stream } = await sb
    .from('streams')
    .select('id, submit_command, allow_anyone, ignored_users, approved')
    .eq('twitch_user_id', broadcasterUserId)
    .single();
  if (!stream) return new NextResponse(null, { status: 204 });
  // Don't ingest for blocked / unapproved channels.
  if (stream.approved === false) return new NextResponse(null, { status: 204 });

  // Parse badges
  const badges: { set_id: string }[] = event.badges || [];
  const badgeSet = new Set(badges.map((b) => b.set_id));
  const isMod = badgeSet.has('moderator') || badgeSet.has('broadcaster');
  const isSub = badgeSet.has('subscriber');
  const isVip = badgeSet.has('vip');

  // Permission gate
  if (!stream.allow_anyone && !(isSub || isMod || isVip)) {
    return new NextResponse(null, { status: 204 });
  }

  // Ignored users
  const ignored: string[] = (stream.ignored_users || []).map((u: string) => u.toLowerCase());
  if (ignored.includes(chatterName.toLowerCase())) {
    return new NextResponse(null, { status: 204 });
  }

  // Command gate
  let payload = messageText;
  if (stream.submit_command) {
    const cmd = stream.submit_command.toLowerCase();
    if (!messageText.toLowerCase().startsWith(cmd)) {
      return new NextResponse(null, { status: 204 });
    }
    payload = messageText.slice(cmd.length).trim();
  }

  // Extract URLs
  const urls = extractUrlsFromMessage(payload);
  if (urls.length === 0) {
    return new NextResponse(null, { status: 204 });
  }

  // Submit each URL to the queue (includes dedup + AI extraction — several
  // seconds). Twitch expects a fast ack and retries slow/failed deliveries
  // (which is what caused duplicate ingestion before the idempotency guard
  // above), and enough retries eventually gets a subscription revoked. So we
  // respond immediately and let the work finish in the background; waitUntil
  // keeps this invocation alive to do it instead of the platform freezing/
  // recycling it right after the response is sent.
  waitUntil(
    Promise.all(
      urls.map((url) =>
        submitUrlToQueue({
          streamId: stream.id,
          url,
          submitter: chatterName,
          isSub,
          isMod,
          isVip,
          message: messageText,
        }),
      ),
    ).catch((err) => console.error('background submitUrlToQueue failed:', err)),
  );

  return new NextResponse(null, { status: 204 });
}

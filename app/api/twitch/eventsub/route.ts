// Twitch EventSub webhook handler.
// Twitch POSTs chat messages here — no persistent connection needed.

import { NextRequest, NextResponse } from 'next/server';
import { waitUntil } from '@vercel/functions';
import {
  verifySignature,
  isTimestampFresh,
  resolveEventId,
  classifyDedupOutcome,
} from '@/lib/twitch-eventsub';
import { supabaseAdmin } from '@/lib/supabase';
import { extractUrlsFromMessage } from '@/lib/url';
import { submitUrlToQueue } from '@/lib/submit-url';
import { matchQuestionCommand, submitQuestionToQueue } from '@/lib/submit-question';
import { announceSubmission } from '@/lib/announce';
import { checkRateLimit, hashKey } from '@/lib/ratelimit';

export const maxDuration = 30;

// Twitch EventSub message types
const VERIFICATION = 'webhook_callback_verification';
const NOTIFICATION = 'notification';
const REVOCATION = 'revocation';

const VIDEO_COMMAND_COOLDOWN_MS = 15_000;

// Replies in chat with whatever's currently on the deck — same payload as
// the deck's manual "Post to chat" button, but fired for any viewer who
// can't see pinned/announced messages. Sent as the streamer's own stored
// token (there's no logged-in user driving this). The cooldown timestamp is
// claimed up front, before the send even happens, so a burst of the command
// from several viewers at once doesn't all slip through the same window —
// there's a small race if two requests read it in the same instant, but the
// worst case is one extra chat message, not worth guarding further.
async function respondToVideoCommand(stream: {
  id: string;
  twitch_user_id: string;
  now_playing_id: string | null;
  video_command_last_sent_at: string | null;
}) {
  if (!stream.now_playing_id) return; // nothing on air — stay quiet

  const last = stream.video_command_last_sent_at ? new Date(stream.video_command_last_sent_at).getTime() : 0;
  if (Date.now() - last < VIDEO_COMMAND_COOLDOWN_MS) return;

  const sb = supabaseAdmin();
  await sb.from('streams').update({ video_command_last_sent_at: new Date().toISOString() }).eq('id', stream.id);

  const { data: sub } = await sb
    .from('submissions')
    .select('title, url, trigger_warning')
    .eq('id', stream.now_playing_id)
    .eq('stream_id', stream.id)
    .maybeSingle();
  if (!sub) return;

  await announceSubmission(stream.id, stream.twitch_user_id, stream.twitch_user_id, sub).catch((err) =>
    console.error('!video auto-reply failed:', err),
  );
}

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
  const eventId: string = resolveEventId(event, msgId);
  if (eventId) {
    const { error: seenErr } = await sb.from('processed_events').insert({ id: eventId });
    const outcome = classifyDedupOutcome(seenErr);
    if (outcome === 'duplicate') return new NextResponse(null, { status: 204 });
    if (outcome === 'process-with-warning') {
      console.warn('processed_events insert failed (run migration?):', seenErr!.message);
    }
  }

  const broadcasterUserId = event.broadcaster_user_id;
  const chatterName = event.chatter_user_name || event.chatter_user_login || 'anon';
  const messageText = event.message?.text || '';

  // Look up stream
  const { data: stream } = await sb
    .from('streams')
    .select('id, twitch_user_id, submit_command, allow_anyone, ignored_users, approved, video_command, now_playing_id, video_command_last_sent_at, questions_enabled, question_command')
    .eq('twitch_user_id', broadcasterUserId)
    .single();
  if (!stream) return new NextResponse(null, { status: 204 });
  // Don't ingest for blocked / unapproved channels.
  if (stream.approved === false) return new NextResponse(null, { status: 204 });

  // Ignored users — applies to every command, submit or "what's playing" alike.
  const ignored: string[] = (stream.ignored_users || []).map((u: string) => u.toLowerCase());
  if (ignored.includes(chatterName.toLowerCase())) {
    return new NextResponse(null, { status: 204 });
  }

  // "What's playing" — open to everyone, not gated by allow_anyone (that
  // setting is about who's trusted to submit links; this is read-only and
  // exists specifically for viewers who aren't subs/mods/vips and can't see
  // pinned chat). Has its own cooldown since, unlike link submission, it's a
  // query command that can get spammed the moment something's trending.
  if (stream.video_command && messageText.trim().toLowerCase() === stream.video_command.toLowerCase()) {
    waitUntil(respondToVideoCommand(stream));
    return new NextResponse(null, { status: 204 });
  }

  // Parse badges
  const badges: { set_id: string }[] = event.badges || [];
  const badgeSet = new Set(badges.map((b) => b.set_id));
  const isMod = badgeSet.has('moderator') || badgeSet.has('broadcaster');
  const isSub = badgeSet.has('subscriber');
  const isVip = badgeSet.has('vip');

  // Permission gate — shared with the question command below: "everyone,
  // same as link submission's default" was the deliberate call here, so
  // asking a question is gated exactly like submitting a link, not by a
  // second, question-specific permission model.
  if (!stream.allow_anyone && !(isSub || isMod || isVip)) {
    return new NextResponse(null, { status: 204 });
  }

  // !question — gated behind the account-level flag a super admin sets (see
  // schema.sql: a question is free text that can reach the streamer's
  // eyeline live, unlike a link a mod always screens first). When the flag
  // is off, pass null so matchQuestionCommand can never match, rather than
  // trusting stream.question_command alone — a stream that had questions
  // enabled in the past and got it revoked keeps its command text in the
  // row, and it must stay inert.
  const questionText = matchQuestionCommand(
    messageText,
    stream.questions_enabled ? stream.question_command : null,
  );
  if (questionText !== null) {
    // Per-asker, not per-channel like video_command's cooldown: one person
    // shouldn't be able to flood the mod queue during exactly the moment
    // questions matter most (a live interview). checkRateLimit fails open
    // if Upstash isn't configured, same as every other rate-limited path.
    const limited = await checkRateLimit('question', hashKey(`${stream.id}:${chatterName.toLowerCase()}`));
    if (limited.ok) {
      waitUntil(
        submitQuestionToQueue({
          streamId: stream.id,
          text: questionText,
          asker: chatterName,
          isSub,
          isMod,
          isVip,
        }).catch((err) => console.error('background submitQuestionToQueue failed:', err)),
      );
    }
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

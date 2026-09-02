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
import { handleRaffleEntry } from '@/lib/raffle';
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

/**
 * Claims `eventId` in processed_events, so this exact chat message (even if
 * Twitch retries the webhook, or a duplicate subscription delivers it
 * again) is acted on exactly once. Returns false — meaning "already
 * claimed, do nothing" — for a duplicate delivery; true otherwise.
 *
 * Deliberately called only right before a side effect that ISN'T already
 * self-idempotent some other way, not unconditionally for every message:
 *  - respondToVideoCommand has its own cooldown, claimed before it sends —
 *    a retried delivery within that window is already a no-op.
 *  - handleRaffleEntry's insert has a DB-level unique(raffle_id,
 *    chatter_login) constraint — a duplicate entry is already a no-op.
 *  - submitQuestionToQueue has no such constraint (every call inserts a new
 *    row), so a retried delivery WOULD create a duplicate question without
 *    this.
 *  - submitUrlToQueue's own dedup is intentionally bypassable
 *    (allow_duplicates), so a retried delivery of the identical event
 *    would slip past it as if it were a second, distinct submission.
 * Ordinary chat that doesn't match anything never reaches this at all —
 * the common case pays for the stream lookup above and nothing else.
 */
async function claimEventOnce(sb: ReturnType<typeof supabaseAdmin>, eventId: string): Promise<boolean> {
  if (!eventId) return true;
  const { error: seenErr } = await sb.from('processed_events').insert({ id: eventId });
  const outcome = classifyDedupOutcome(seenErr);
  if (outcome === 'duplicate') return false;
  if (outcome === 'process-with-warning') {
    console.warn('processed_events insert failed (run migration?):', seenErr!.message);
  }
  return true;
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

  // event.message_id is stable across every delivery of the same chat
  // message — computing it is free, but CLAIMING it (the processed_events
  // insert) is a DB write, and doing that unconditionally for every message
  // meant every single chat line paid for a write before anything had even
  // looked at its text. The claim is now made lazily, right before each
  // side effect that actually needs it — see claimEventOnce below.
  const eventId: string = resolveEventId(event, msgId);

  const broadcasterUserId = event.broadcaster_user_id;
  const chatterName = event.chatter_user_name || event.chatter_user_login || 'anon';
  const messageText = event.message?.text || '';

  // Look up stream — the one DB read every notification-type message still
  // has to pay for: which commands this channel even listens for (and
  // whether it's blocked, and who's ignored) all live on this row, so
  // there's no way to tell "this message doesn't matter" without it.
  const { data: stream } = await sb
    .from('streams')
    .select('id, twitch_user_id, submit_command, allow_anyone, ignored_users, approved, video_command, now_playing_id, video_command_last_sent_at, questions_enabled, question_command, questions_open, raffle_enabled')
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

  // !question — two independent gates, both must pass. questions_enabled is
  // the super admin's account-level switch (see schema.sql: a question is
  // free text that can reach the streamer's eyeline live, unlike a link a
  // mod always screens first). questions_open is the streamer's own pause —
  // separate so they can stop taking questions mid-show without clearing
  // their configured command text. Either being off passes null, so
  // matchQuestionCommand can never match rather than trusting
  // stream.question_command alone — a stream that had this enabled in the
  // past (by either party) and got it turned off keeps its command text in
  // the row, and it must stay inert either way.
  const questionText = matchQuestionCommand(
    messageText,
    stream.questions_enabled && stream.questions_open ? stream.question_command : null,
  );
  // !enter (or whatever the currently-open raffle's command is) — its own
  // branch, not folded into the question block above, because there is no
  // stream.raffle_command to check up front: the command lives on the
  // raffle row itself and is only known once one's fetched, which
  // handleRaffleEntry does. Deliberately does NOT return early after this —
  // unlike a matched question, a raffle entry doesn't preclude the same
  // message also being a link submission (submit_command and a raffle
  // command are never expected to collide), so link handling below still
  // runs regardless.
  if (stream.raffle_enabled) {
    waitUntil(
      handleRaffleEntry(stream.id, messageText, chatterName, isSub, isVip).catch((err) =>
        console.error('background handleRaffleEntry failed:', err),
      ),
    );
  }

  if (questionText !== null) {
    // Claimed here, not up front — see claimEventOnce's doc comment.
    // submitQuestionToQueue has no dedup of its own, so a retried delivery
    // without this would land as a second, duplicate question.
    if (!(await claimEventOnce(sb, eventId))) return new NextResponse(null, { status: 204 });
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
    // The common case — ordinary chat, or a command that carried no link —
    // ends here having paid for exactly one DB call (the stream lookup
    // above), not two: nothing happened, so there's nothing to claim.
    return new NextResponse(null, { status: 204 });
  }

  // Claimed here, not up front — see claimEventOnce's doc comment.
  // submitUrlToQueue's own dedup is intentionally bypassable
  // (allow_duplicates), so a retried delivery without this could slip
  // through as if it were a second, distinct submission.
  if (!(await claimEventOnce(sb, eventId))) return new NextResponse(null, { status: 204 });

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

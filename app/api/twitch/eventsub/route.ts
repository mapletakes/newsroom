// Twitch EventSub webhook handler.
// Twitch POSTs chat messages here — no persistent connection needed.

import { NextRequest, NextResponse } from 'next/server';
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

  // ── Verify signature ──────────────────────────────────────────
  if (!verifySignature(msgId, msgTs, rawBody, msgSig)) {
    return new NextResponse('invalid signature', { status: 403 });
  }
  if (!isTimestampFresh(msgTs)) {
    return new NextResponse('stale timestamp', { status: 403 });
  }

  const body = JSON.parse(rawBody);

  // ── Verification challenge (subscription creation handshake) ──
  if (msgType === VERIFICATION) {
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

  const broadcasterUserId = event.broadcaster_user_id;
  const chatterName = event.chatter_user_name || event.chatter_user_login || 'anon';
  const messageText = event.message?.text || '';

  // Look up stream
  const sb = supabaseAdmin();
  const { data: stream } = await sb
    .from('streams')
    .select('id, submit_command, allow_anyone, ignored_users')
    .eq('twitch_user_id', broadcasterUserId)
    .single();
  if (!stream) return new NextResponse(null, { status: 204 });

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

  // Submit each URL to the queue (includes dedup + AI extraction)
  await Promise.all(
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
  );

  return new NextResponse(null, { status: 204 });
}

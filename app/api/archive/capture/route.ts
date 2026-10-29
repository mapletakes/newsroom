// Snapshot capture from the browser extension ("Archive this page").
//
// The page comes from the reader's own browser — their IP, their session,
// their subscription — so it works on sites that refuse our server outright
// and behind paywalls the reader is signed in to. The extension strips
// scripts and signed-in details before sending (extension/capture.js); the
// freezer here then does everything it does for a server capture (inlining,
// CSS slimming, sanitising) on that HTML.
//
// Auth is the personal add token, like quick-add. The body is JSON
// { url, html }, gzipped when the extension sends X-Content-Encoding: gzip,
// which keeps typical pages well under the 4.5 MB request limit.

import { NextRequest, NextResponse } from 'next/server';
import { gunzipSync } from 'zlib';
import { supabaseAdmin } from '@/lib/supabase';
import { checkRateLimit, hashKey } from '@/lib/ratelimit';
import { addToDeck } from '@/lib/deck-add';
import { normalizeUrl } from '@/lib/url';
import { freezeHtml } from '@/lib/archive-freeze';
import { deleteArchive, storeSnapshot } from '@/lib/archive';
import { broadcastQueueChange } from '@/lib/realtime';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-Add-Token, X-Content-Encoding',
};

const MAX_HTML_BYTES = 25 * 1024 * 1024;

export async function OPTIONS() {
  return new NextResponse(null, { headers: CORS });
}

const fail = (error: string, status: number) => NextResponse.json({ ok: false, error }, { status, headers: CORS });

export async function POST(req: NextRequest) {
  const token = req.headers.get('x-add-token') || '';
  if (!token) return fail('missing token', 401);

  const limited = await checkRateLimit('write', hashKey(token));
  if (!limited.ok) return fail('rate limited, try again shortly', 429);

  let body: { url?: unknown; html?: unknown };
  try {
    let raw = Buffer.from(await req.arrayBuffer());
    if (req.headers.get('x-content-encoding') === 'gzip') raw = gunzipSync(raw, { maxOutputLength: MAX_HTML_BYTES + 1024 });
    body = JSON.parse(raw.toString('utf8'));
  } catch {
    return fail('unreadable capture', 400);
  }
  const url = typeof body.url === 'string' ? body.url.trim() : '';
  const html = typeof body.html === 'string' ? body.html : '';
  if (!/^https?:\/\//i.test(url) || !html) return fail('missing url or html', 400);
  if (Buffer.byteLength(html, 'utf8') > MAX_HTML_BYTES) return fail('page too large to capture', 413);

  const sb = supabaseAdmin();
  const { data: stream } = await sb
    .from('streams')
    .select('id, twitch_login, display_name, approved')
    .eq('add_token', token)
    .maybeSingle();
  if (!stream || stream.approved === false) return fail('invalid token', 401);

  // The item this page belongs to: the newest one with the same link, or a
  // new deck item when it isn't on the channel yet (archiving a page you're
  // reading is also the natural moment to add it).
  const findItem = async () =>
    (
      await sb
        .from('submissions')
        .select('id, title, archive_url')
        .eq('stream_id', stream.id)
        .eq('normalized_url', normalizeUrl(url))
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()
    ).data;
  let item = await findItem();
  let added = false;
  if (!item) {
    const result = await addToDeck(stream.id, url, stream.twitch_login || stream.display_name || 'quick-add', null);
    if (!result.ok) return fail(result.error || 'could not add the page to the deck', 400);
    item = await findItem();
    added = true;
    if (!item) return fail('could not add the page to the deck', 500);
  }

  let link: string;
  let title: string | null;
  try {
    const frozen = await freezeHtml(html, url);
    title = frozen.title;
    link = await storeSnapshot(sb, frozen, {
      url,
      submissionId: item.id,
      streamId: stream.id,
      appUrl: process.env.NEXT_PUBLIC_APP_URL || req.nextUrl.origin,
      method: 'extension',
    });
  } catch (err) {
    console.error('archive capture failed:', (err as Error).message);
    return fail('could not save the snapshot', 500);
  }

  // A browser capture is the better copy: it replaces whatever the item had
  // (our earlier snapshot is deleted; an archive.today link just goes), and
  // show notes that already carried the old link follow it.
  const old = item.archive_url as string | null;
  await sb
    .from('submissions')
    .update({ archive_url: link, ...(item.title || !title ? {} : { title }) })
    .eq('id', item.id);
  if (old && old !== link) {
    await sb.from('show_notes').update({ archive_url: link }).eq('stream_id', stream.id).eq('archive_url', old);
    await deleteArchive(sb, old, stream.id).catch((err) =>
      console.error('archive capture: removing the previous snapshot failed:', (err as Error).message),
    );
  }
  broadcastQueueChange(stream.id);

  return NextResponse.json({ ok: true, archive_url: link, submission_id: item.id, added }, { headers: CORS });
}

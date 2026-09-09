// Discord export: posts the "played" list (show_notes) to a streamer's own
// Discord channel via an incoming webhook they paste into /setup. A webhook
// rather than a bot on purpose — it's a URL the streamer creates themselves
// in their own channel settings, so there's no bot token to host, no guild
// install flow, and no channel picker to build. It only earns an upgrade to
// a bot if a future feature needs to read the channel back or pick among
// several.

import { supabaseAdmin } from './supabase';
import { decryptSecret } from './crypto';

const DISCORD_MAX_CHARS = 2000;

// Discord's own webhook domains. discord.com is current; the others are
// legacy/beta hosts Discord has issued webhook URLs under historically.
// Anything else is refused outright rather than fetched — this is the one
// check standing between a pasted URL and an outbound POST, since webhook
// URLs aren't validated by calling them the way an OAuth flow would.
const ALLOWED_HOSTS = new Set(['discord.com', 'discordapp.com', 'ptb.discord.com', 'canary.discord.com']);

export type WebhookValidation = { ok: true; url: string } | { ok: false; error: string };

/**
 * Checks that a pasted URL looks like a genuine Discord incoming webhook
 * before it's ever stored or POSTed to: https, a Discord host, and the
 * `/api/webhooks/<id>/<token>` shape. Returns the URL normalised to just
 * that path (query string and trailing slash stripped) so a webhook copied
 * with `?wait=true` or a trailing slash still compares/stores cleanly.
 */
export function validateWebhookUrl(raw: string): WebhookValidation {
  let u: URL;
  try {
    u = new URL(raw.trim());
  } catch {
    return { ok: false, error: 'Not a valid URL.' };
  }
  if (u.protocol !== 'https:') return { ok: false, error: 'Must be an https:// URL.' };
  if (!ALLOWED_HOSTS.has(u.hostname.toLowerCase())) {
    return { ok: false, error: 'Must be a discord.com webhook URL.' };
  }
  if (!/^\/api\/webhooks\/\d+\/[\w-]+\/?$/.test(u.pathname)) {
    return {
      ok: false,
      error: 'Must look like a Discord incoming webhook URL (…/api/webhooks/<id>/<token>).',
    };
  }
  const path = u.pathname.endsWith('/') ? u.pathname.slice(0, -1) : u.pathname;
  return { ok: true, url: `${u.origin}${path}` };
}

export type PlayedNote = {
  title: string | null;
  url: string;
  played_at: string;
  takeaway?: string | null;
};

// Escapes just what could otherwise break out of the `[title](url)` link
// (a literal `]` closes the link text early) or trigger unintended emphasis
// in a title/takeaway pulled from a webpage or typed live mid-show.
function escapeMarkdown(s: string): string {
  return s.replace(/[\\[\]*_~`|]/g, '\\$&');
}

function formatElapsed(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  const ss = String(s).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

/**
 * Builds the Discord message(s) for a batch of played items: a header line
 * with the item count, then one numbered `[title](url) · +elapsed` line per
 * item (elapsed = time since the first item in the batch, since
 * show_notes.stream_started_at isn't populated by the play handler — this is
 * still enough to find the spot in a VOD), with the streamer's takeaway
 * indented underneath when there is one.
 *
 * Split into multiple messages if the total would exceed Discord's
 * 2000-character content cap — split between items, never mid-item, so a
 * message boundary never lands inside a link or a takeaway.
 */
export function buildPlayedMessages(displayName: string, notes: PlayedNote[]): string[] {
  if (notes.length === 0) return [];

  const dateStr = new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  const header = `**Played on ${displayName || 'stream'} · ${dateStr}** (${notes.length} item${notes.length === 1 ? '' : 's'})`;

  const firstPlayedAt = new Date(notes[0].played_at).getTime();
  const blocks = notes.map((n, i) => {
    const elapsed = formatElapsed(Math.max(0, new Date(n.played_at).getTime() - firstPlayedAt));
    const title = escapeMarkdown((n.title || n.url).trim());
    const lines = [`${i + 1}. [${title}](${n.url}) · +${elapsed}`];
    const takeaway = (n.takeaway || '').trim();
    if (takeaway) lines.push(`   ↳ ${escapeMarkdown(takeaway)}`);
    let block = lines.join('\n');
    // A single item pathologically longer than the whole cap (a huge
    // takeaway) gets truncated rather than sent as its own oversized
    // message that Discord would reject outright.
    if (block.length > DISCORD_MAX_CHARS - 1) block = block.slice(0, DISCORD_MAX_CHARS - 2) + '…';
    return block;
  });

  const messages: string[] = [];
  let current = header;
  for (const block of blocks) {
    const candidate = `${current}\n${block}`;
    if (candidate.length > DISCORD_MAX_CHARS) {
      messages.push(current);
      current = block;
    } else {
      current = candidate;
    }
  }
  messages.push(current);
  return messages;
}

/**
 * Loads whatever's played since the last Discord post (or all of it, on the
 * first post ever) for previewing or sending. Returns null only when the
 * stream row itself can't be found — an empty pending list is a valid,
 * non-null result ("nothing new to post").
 */
export async function getPendingPlayedNotes(
  streamId: string,
): Promise<{ displayName: string; notes: PlayedNote[]; webhookUrl: string | null } | null> {
  const sb = supabaseAdmin();
  const { data: stream } = await sb
    .from('streams')
    .select('display_name, discord_webhook_url, discord_posted_at')
    .eq('id', streamId)
    .maybeSingle();
  if (!stream) return null;

  let q = sb
    .from('show_notes')
    .select('title, url, played_at, takeaway')
    .eq('stream_id', streamId)
    .order('played_at', { ascending: true });
  if (stream.discord_posted_at) q = q.gt('played_at', stream.discord_posted_at);
  const { data: notes } = await q;

  return {
    displayName: stream.display_name || 'stream',
    notes: notes || [],
    webhookUrl: decryptSecret(stream.discord_webhook_url),
  };
}

async function sendWebhookMessage(
  webhookUrl: string,
  content: string,
  attempt = 0,
): Promise<{ ok: boolean; error?: string }> {
  // A direct fetch, not lib/safe-fetch.ts's safeFetchText: that helper is
  // built for GET-ing pages a viewer linked to (SSRF-guards an arbitrary
  // host), whereas this URL is already restricted to Discord's own domains
  // by validateWebhookUrl at save time, and it's a POST of JSON we composed
  // ourselves, not a page body being read.
  let res: Response;
  try {
    res = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content, flags: 4 }), // SUPPRESS_EMBEDS — a batch of links shouldn't each unfurl into a card
    });
  } catch {
    return { ok: false, error: 'could not reach discord' };
  }
  if (res.status === 429 && attempt < 3) {
    const body = await res.json().catch(() => ({}) as { retry_after?: number });
    const waitMs = Math.min(Math.ceil((body.retry_after ?? 1) * 1000), 5000);
    await new Promise((r) => setTimeout(r, waitMs));
    return sendWebhookMessage(webhookUrl, content, attempt + 1);
  }
  if (res.status === 404) return { ok: false, error: 'webhook not found — it may have been deleted in Discord' };
  if (!res.ok) return { ok: false, error: `discord responded ${res.status}` };
  return { ok: true };
}

export type PostPlayedListResult =
  | { ok: true; count: number }
  | { ok: false; error: 'not-found' | 'no-webhook' | 'nothing-to-post' | string };

/**
 * Sends everything played since the last Discord post to the stream's
 * configured webhook, then advances discord_posted_at — but only once every
 * message in the batch has sent successfully, so a mid-batch failure (rate
 * limit exhausted, webhook deleted) can be retried from the same starting
 * point rather than silently skipping whatever didn't make it.
 */
export async function postPlayedList(streamId: string): Promise<PostPlayedListResult> {
  const pending = await getPendingPlayedNotes(streamId);
  if (!pending) return { ok: false, error: 'not-found' };
  if (!pending.webhookUrl) return { ok: false, error: 'no-webhook' };
  if (pending.notes.length === 0) return { ok: false, error: 'nothing-to-post' };

  const messages = buildPlayedMessages(pending.displayName, pending.notes);
  for (const content of messages) {
    const sent = await sendWebhookMessage(pending.webhookUrl, content);
    if (!sent.ok) return { ok: false, error: sent.error || 'failed' };
  }

  const sb = supabaseAdmin();
  await sb.from('streams').update({ discord_posted_at: new Date().toISOString() }).eq('id', streamId);
  return { ok: true, count: pending.notes.length };
}

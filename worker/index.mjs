// Newsroom chat worker — connects to all registered Twitch channels
// via IRC and posts extracted URLs to the Newsroom API.
//
// Deploy as an always-on process (Railway, Fly.io, etc.)
//
// Required env vars:
//   NEXT_PUBLIC_SUPABASE_URL   — Supabase project URL
//   SUPABASE_SERVICE_ROLE_KEY  — Supabase service role key
//   APP_URL                    — Newsroom app URL (e.g. https://newsroom.vercel.app)
//   WORKER_API_KEY             — shared secret with the Newsroom API

import { createClient } from '@supabase/supabase-js';
import tmi from 'tmi.js';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const APP_URL = (process.env.APP_URL || '').replace(/\/+$/, '');
const WORKER_KEY = process.env.WORKER_API_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY || !APP_URL || !WORKER_KEY) {
  console.error('Missing required env vars. Need: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, APP_URL, WORKER_API_KEY');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// ── URL extraction ──────────────────────────────────────────────
const URL_RE = /https?:\/\/[^\s<>"'`]+/gi;
function extractUrls(message) {
  const matches = message.match(URL_RE) || [];
  return matches.map((m) => m.replace(/[.,;:!?)\]]+$/, ''));
}

// ── Stream config ───────────────────────────────────────────────
/** @type {Map<string, {streamId:string, submitCommand:string|null, allowAnyone:boolean, ignoredUsers:string[]}>} */
const streams = new Map();

async function loadStreams() {
  const { data, error } = await supabase
    .from('streams')
    .select('id, twitch_login, submit_command, allow_anyone, ignored_users');
  if (error) {
    console.error('Failed to load streams:', error.message);
    return;
  }
  const before = new Set(streams.keys());
  const after = new Set();
  for (const s of data || []) {
    const ch = s.twitch_login.toLowerCase();
    after.add(ch);
    streams.set(ch, {
      streamId: s.id,
      submitCommand: s.submit_command || null,
      allowAnyone: s.allow_anyone ?? true,
      ignoredUsers: (s.ignored_users || []).map((u) => u.toLowerCase()),
    });
  }
  // Join / part channels that changed
  if (client) {
    for (const ch of after) {
      if (!before.has(ch)) {
        console.log(`Joining #${ch}`);
        client.join(ch).catch(() => {});
      }
    }
    for (const ch of before) {
      if (!after.has(ch)) {
        console.log(`Parting #${ch}`);
        client.part(ch).catch(() => {});
        streams.delete(ch);
      }
    }
  }
  console.log(`Streams loaded: ${streams.size} channel(s)`);
}

// ── Submit URL to Newsroom API ──────────────────────────────────
async function submitUrl(streamId, url, submitter, isSub, isMod, isVip, message) {
  try {
    const r = await fetch(`${APP_URL}/api/queue`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Worker-Key': WORKER_KEY,
      },
      body: JSON.stringify({
        stream_id: streamId,
        url,
        submitter,
        isSub,
        isMod,
        isVip,
        message,
      }),
    });
    if (!r.ok) {
      const body = await r.text();
      console.error(`API error ${r.status} for ${url}: ${body}`);
    }
  } catch (err) {
    console.error(`Failed to submit ${url}:`, err.message);
  }
}

// ── Twitch IRC ──────────────────────────────────────────────────
/** @type {tmi.Client|null} */
let client = null;

async function start() {
  await loadStreams();
  const channels = Array.from(streams.keys());
  if (channels.length === 0) {
    console.log('No streams registered yet. Will check again in 60s.');
  }

  client = new tmi.Client({
    options: { debug: false },
    connection: { reconnect: true, secure: true },
    channels,
  });

  client.on('connected', () => console.log('Connected to Twitch IRC'));
  client.on('disconnected', (reason) => console.log('Disconnected:', reason));

  client.on('message', (channel, tags, message, self) => {
    if (self) return;
    const ch = channel.replace(/^#/, '').toLowerCase();
    const config = streams.get(ch);
    if (!config) return;

    const isMod = !!tags.mod || tags.badges?.broadcaster === '1';
    const isSub = !!tags.subscriber || !!tags.badges?.subscriber;
    const isVip = !!tags.badges?.vip;
    const submitter = tags['display-name'] || tags.username || 'anon';

    // Permission gate
    if (!config.allowAnyone && !(isSub || isMod || isVip)) return;

    // Ignored users
    if (config.ignoredUsers.includes(submitter.toLowerCase())) return;

    // Command gate
    let payload = message;
    if (config.submitCommand) {
      const cmd = config.submitCommand.toLowerCase();
      if (!message.toLowerCase().startsWith(cmd)) return;
      payload = message.slice(cmd.length).trim();
    }

    const urls = extractUrls(payload);
    for (const url of urls) {
      submitUrl(config.streamId, url, submitter, isSub, isMod, isVip, message);
    }
  });

  await client.connect();

  // Reload stream configs every 60s to pick up new channels / setting changes
  setInterval(loadStreams, 60_000);
}

start().catch((err) => {
  console.error('Worker failed:', err);
  process.exit(1);
});

// Twitch OAuth Authorization Code flow (server-side).
// user:read:chat is required for EventSub channel.chat.message webhooks.

const SCOPES = [
  'user:read:email',
  'user:read:chat',
  'user:write:chat', // post "now watching" messages to the streamer's own chat
  'user:bot',
  'user:read:moderated_channels',
  // Pin a posted "now watching" message via Send Chat Message's `pin` flag
  // (sendChatMessage below). Only takes effect for accounts that have
  // reconnected since this scope was added — an already-stored token from
  // before doesn't retroactively gain it.
  'moderator:manage:chat_messages',
];

export function buildAuthUrl(state: string): string {
  const clientId = process.env.NEXT_PUBLIC_TWITCH_CLIENT_ID!;
  const redirect = `${(process.env.NEXT_PUBLIC_APP_URL || '').replace(/\/+$/, '')}/api/twitch/callback`;
  const u = new URL('https://id.twitch.tv/oauth2/authorize');
  u.searchParams.set('client_id', clientId);
  u.searchParams.set('redirect_uri', redirect);
  u.searchParams.set('response_type', 'code');
  u.searchParams.set('scope', SCOPES.join(' '));
  u.searchParams.set('state', state);
  u.searchParams.set('force_verify', 'true');
  return u.toString();
}

export async function exchangeCode(code: string): Promise<{
  access_token: string;
  refresh_token: string;
  expires_in: number;
  scope: string[];
}> {
  const clientId = process.env.NEXT_PUBLIC_TWITCH_CLIENT_ID!;
  const clientSecret = process.env.TWITCH_CLIENT_SECRET!;
  const redirect = `${(process.env.NEXT_PUBLIC_APP_URL || '').replace(/\/+$/, '')}/api/twitch/callback`;
  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    code,
    grant_type: 'authorization_code',
    redirect_uri: redirect,
  });
  const r = await fetch('https://id.twitch.tv/oauth2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  if (!r.ok) throw new Error(`Twitch token exchange failed: ${r.status}`);
  const data = await r.json();
  console.log('Twitch OAuth scopes granted:', data.scope);
  return data;
}

export async function fetchTwitchUser(accessToken: string): Promise<{
  id: string;
  login: string;
  display_name: string;
  email?: string;
}> {
  const clientId = process.env.NEXT_PUBLIC_TWITCH_CLIENT_ID!;
  const r = await fetch('https://api.twitch.tv/helix/users', {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Client-Id': clientId,
    },
  });
  if (!r.ok) throw new Error(`Twitch user fetch failed: ${r.status}`);
  const data = await r.json();
  const u = data.data?.[0];
  if (!u) throw new Error('No user in Twitch response');
  return u;
}

export async function refreshAccessToken(refreshToken: string): Promise<{
  access_token: string;
  refresh_token: string;
  expires_in: number;
} | null> {
  const clientId = process.env.NEXT_PUBLIC_TWITCH_CLIENT_ID!;
  const clientSecret = process.env.TWITCH_CLIENT_SECRET!;
  const r = await fetch('https://id.twitch.tv/oauth2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
    }),
  });
  if (!r.ok) return null;
  return r.json();
}

/**
 * Send a chat message to a broadcaster's channel as `senderId`.
 * For posting to your own channel, senderId === broadcasterId.
 * Requires a user access token with the `user:write:chat` scope.
 *
 * `pin`, when true, additionally requires `moderator:manage:chat_messages`
 * and the sender to be the broadcaster or a moderator — Twitch pins it for a
 * fixed 20 minutes, and only one message can be pinned at a time (this
 * silently replaces whatever was already pinned). Per Twitch's documented
 * contract, a pin failure fails the whole send: nothing is posted, not "sent
 * but unpinned" — so there's no separate pin step to retry here, just the one
 * request either succeeding or not.
 */
export async function sendChatMessage(
  accessToken: string,
  broadcasterId: string,
  senderId: string,
  message: string,
  pin = false,
): Promise<{ ok: boolean; error?: string }> {
  const clientId = process.env.NEXT_PUBLIC_TWITCH_CLIENT_ID!;
  const r = await fetch('https://api.twitch.tv/helix/chat/messages', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Client-Id': clientId,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      broadcaster_id: broadcasterId,
      sender_id: senderId,
      message,
      ...(pin ? { pin: true } : {}),
    }),
  });

  if (!r.ok) {
    const text = await r.text().catch(() => '');
    return { ok: false, error: `Twitch ${r.status}: ${text}` };
  }
  const data = await r.json().catch(() => null);
  const sent = data?.data?.[0];
  if (sent && sent.is_sent === false) {
    return { ok: false, error: sent.drop_reason?.message || 'message dropped' };
  }
  return { ok: true };
}

export async function fetchModeratedChannels(
  accessToken: string,
  userId: string,
): Promise<{ broadcaster_id: string; broadcaster_login: string; broadcaster_name: string }[]> {
  const clientId = process.env.NEXT_PUBLIC_TWITCH_CLIENT_ID!;
  const out: { broadcaster_id: string; broadcaster_login: string; broadcaster_name: string }[] = [];
  let cursor: string | undefined;
  for (let i = 0; i < 5; i++) {
    const u = new URL('https://api.twitch.tv/helix/moderation/channels');
    u.searchParams.set('user_id', userId);
    u.searchParams.set('first', '100');
    if (cursor) u.searchParams.set('after', cursor);
    const r = await fetch(u, {
      headers: { Authorization: `Bearer ${accessToken}`, 'Client-Id': clientId },
    });
    if (!r.ok) break;
    const data = await r.json();
    for (const ch of data.data || []) out.push(ch);
    cursor = data.pagination?.cursor;
    if (!cursor) break;
  }
  return out;
}

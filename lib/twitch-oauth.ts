// Twitch OAuth Authorization Code flow (server-side).
// user:read:chat is required for EventSub channel.chat.message webhooks.

const SCOPES = ['user:read:email', 'user:read:chat', 'user:read:moderated_channels'];

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
  return r.json();
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

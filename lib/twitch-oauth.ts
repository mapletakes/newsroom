// Twitch OAuth Authorization Code flow (server-side).
// Scopes: chat:read is the only one we need for MVP.

const SCOPES = ['user:read:email', 'chat:read', 'moderation:read'];

export function buildAuthUrl(state: string): string {
  const clientId = process.env.NEXT_PUBLIC_TWITCH_CLIENT_ID!;
  const redirect = `${(process.env.NEXT_PUBLIC_APP_URL || '').replace(/\/+$/, '')}/api/twitch/callback`;
  const u = new URL('https://id.twitch.tv/oauth2/authorize');
  u.searchParams.set('client_id', clientId);
  u.searchParams.set('redirect_uri', redirect);
  u.searchParams.set('response_type', 'code');
  u.searchParams.set('scope', SCOPES.join(' '));
  u.searchParams.set('state', state);
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

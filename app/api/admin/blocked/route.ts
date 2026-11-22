import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { getSession, sessionLogin } from '@/lib/session';
import { isAdmin } from '@/lib/admin';
import { logAdminAction } from '@/lib/audit';
import { blockUser, listBlockedUsers, lookupTwitchUserByLogin, unblockUser } from '@/lib/blocked-users';

export const dynamic = 'force-dynamic';

// Twitch logins: 4 to 25 of letters, digits and underscore. Checked here so the
// value is never sent to Twitch's API as anything else.
const LOGIN_RE = /^[a-z0-9_]{1,25}$/;
const REASON_MAX = 200;

async function adminSession() {
  const session = await getSession();
  return session && isAdmin(session.twitchUserId) ? session : null;
}

const forbidden = () => NextResponse.json({ error: 'forbidden' }, { status: 403 });

// The block list. Super-admin only.
export async function GET() {
  if (!(await adminSession())) return forbidden();
  return NextResponse.json({ users: await listBlockedUsers(supabaseAdmin()) });
}

// Blocks a person everywhere: no sign-in, no use of a session they already
// hold, and they are removed as a moderator from every channel. By login, which
// is what an admin has to hand; the Twitch id it resolves to is what's stored.
export async function POST(req: NextRequest) {
  const session = await adminSession();
  if (!session) return forbidden();

  const body = await req.json().catch(() => ({}));
  const login = String(body.login || '').trim().replace(/^@/, '').toLowerCase();
  if (!LOGIN_RE.test(login)) return NextResponse.json({ error: 'That isn’t a valid Twitch username.' }, { status: 400 });
  const reason = typeof body.reason === 'string' ? body.reason.trim().slice(0, REASON_MAX) || null : null;

  const found = await lookupTwitchUserByLogin(login);
  if (found === 'error') {
    return NextResponse.json({ error: 'Couldn’t reach Twitch to look that user up. Try again.' }, { status: 502 });
  }
  if (!found) return NextResponse.json({ error: 'No Twitch user has that name.' }, { status: 404 });
  // A block that locked the admins out would leave nobody able to lift it.
  if (isAdmin(found.id)) return NextResponse.json({ error: 'Admins can’t be blocked.' }, { status: 400 });

  const sb = supabaseAdmin();
  const result = await blockUser(sb, found, sessionLogin(session), reason);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 500 });

  await logAdminAction(sb, session, 'block_user', null, { login: found.login, twitchUserId: found.id, reason });
  return NextResponse.json({ ok: true, user: result.user });
}

export async function DELETE(req: NextRequest) {
  const session = await adminSession();
  if (!session) return forbidden();

  const body = await req.json().catch(() => ({}));
  const twitchUserId = typeof body.twitchUserId === 'string' && /^\d{1,20}$/.test(body.twitchUserId) ? body.twitchUserId : '';
  if (!twitchUserId) return NextResponse.json({ error: 'invalid id' }, { status: 400 });

  const sb = supabaseAdmin();
  const result = await unblockUser(sb, twitchUserId);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 500 });

  await logAdminAction(sb, session, 'unblock_user', null, { twitchUserId });
  return NextResponse.json({ ok: true });
}

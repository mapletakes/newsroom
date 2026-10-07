import { NextRequest, NextResponse } from 'next/server';
import { normalizeEmail, hashEmail, sendMagicLink } from '@/lib/auth-email';
import { checkRateLimit } from '@/lib/ratelimit';

export const dynamic = 'force-dynamic';

// Emails a sign-in link. Always answers { ok: true } for a well-formed address
// whether or not the send worked or the account exists, so the form can't be
// used to probe which addresses have accounts.
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const email = normalizeEmail(body.email);
  if (!email) return NextResponse.json({ error: 'Enter a valid email address.' }, { status: 400 });

  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
  const [byEmail, byIp] = await Promise.all([
    checkRateLimit('auth-email', hashEmail(email)),
    checkRateLimit('auth-ip', ip),
  ]);
  const limited = !byEmail.ok ? byEmail : !byIp.ok ? byIp : null;
  if (limited && !limited.ok) {
    return NextResponse.json(
      { error: 'Too many sign-in requests. Try again in a few minutes.' },
      { status: 429, headers: { 'Retry-After': String(limited.retryAfterSeconds) } },
    );
  }

  const result = await sendMagicLink(email);
  if (!result.ok) console.error('Magic link send failed:', result.error);
  return NextResponse.json({ ok: true });
}

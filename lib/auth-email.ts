import crypto from 'crypto';
import { createClient } from '@supabase/supabase-js';
import { supabaseAdmin } from './supabase';

// Email sign-in via Supabase Auth magic links. Supabase is used ONLY to prove
// control of an email address; once verified, the app mints its own signed
// session cookie (lib/session.ts), exactly as the Twitch flow does, so nothing
// else in the app needs to know a second auth system exists.
//
// The anon-key client here deliberately doesn't persist anything: there is no
// Supabase session to keep, only a one-time token to exchange.

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Lowercased, trimmed address, or null if it isn't plausibly an email. */
export function normalizeEmail(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const e = raw.trim().toLowerCase();
  if (e.length > 254 || !EMAIL_RE.test(e)) return null;
  return e;
}

export function hashEmail(email: string): string {
  return crypto.createHash('sha256').update(email).digest('hex').slice(0, 32);
}

function authClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) throw new Error('Missing Supabase env vars');
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

export function callbackUrl(): string {
  return `${(process.env.NEXT_PUBLIC_APP_URL || '').replace(/\/+$/, '')}/auth/callback`;
}

/** Asks Supabase to email a sign-in link. Creates the auth user on first use. */
export async function sendMagicLink(email: string): Promise<{ ok: boolean; error?: string }> {
  const { error } = await authClient().auth.signInWithOtp({
    email,
    options: { shouldCreateUser: true, emailRedirectTo: callbackUrl() },
  });
  return error ? { ok: false, error: error.message } : { ok: true };
}

/** Exchanges the token_hash from the emailed link for the verified user. */
export async function verifyMagicLink(
  tokenHash: string,
): Promise<{ id: string; email: string } | null> {
  const { data, error } = await authClient().auth.verifyOtp({ token_hash: tokenHash, type: 'email' });
  const user = data?.user;
  if (error || !user?.id || !user.email) return null;
  return { id: user.id, email: user.email.toLowerCase() };
}

export type EmailStream = { id: string; display_name: string | null };

/** The stream for this auth user, created on first sign-in. Deliberately NOT
 *  subject to REQUIRE_APPROVAL (which gates new Twitch streamers): email
 *  signup is open to anyone for now. */
export async function findOrCreateEmailStream(user: {
  id: string;
  email: string;
}): Promise<{ stream: EmailStream; isNew: boolean }> {
  const sb = supabaseAdmin();

  const { data: existing } = await sb
    .from('streams')
    .select('id, display_name')
    .eq('auth_user_id', user.id)
    .maybeSingle();
  if (existing) return { stream: existing, isNew: false };

  const row: Record<string, unknown> = {
    auth_user_id: user.id,
    email: user.email,
    display_name: user.email.split('@')[0],
  };

  // upsert-on-conflict so two near-simultaneous first clicks of the same link
  // converge on one row instead of one of them failing on the unique index.
  const { data: created, error } = await sb
    .from('streams')
    .upsert(row, { onConflict: 'auth_user_id' })
    .select('id, display_name')
    .single();
  if (error || !created) throw error || new Error('No stream row');
  return { stream: created, isNew: true };
}

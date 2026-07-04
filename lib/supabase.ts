import { createClient } from '@supabase/supabase-js';

// Server-only client using the service role.
// Never import this in a client component.
export function supabaseAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error('Missing Supabase env vars');
  }
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: {
      // Next.js's App Router patches the global fetch() with its own
      // caching layer, and supabase-js's REST/Postgres calls go through
      // that same global fetch under the hood. Marking a ROUTE
      // `force-dynamic` only controls whether Next caches that route's own
      // response — it doesn't stop Next from caching supabase-js's internal
      // calls made *during* that route's execution. Without this override,
      // a query with a stable shape (e.g. the overlay's `add_token=eq.<token>`
      // lookup, polled repeatedly with the same filter) can silently return
      // the same first-ever snapshot forever, no matter what changes in the
      // database — the bug behind the overlay showing stale now-playing
      // data while other routes reading the same table stayed fresh.
      fetch: (input, init) => fetch(input, { ...init, cache: 'no-store' }),
    },
  });
}

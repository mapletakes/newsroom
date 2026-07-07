import * as Sentry from '@sentry/nextjs';
import { scrubTokens } from '@/lib/sentry-scrub';

// Error tracking only — optional, same fail-open pattern as rate limiting and
// Brave Search: if NEXT_PUBLIC_SENTRY_DSN is unset, Sentry.init is a no-op
// and every capture call below silently does nothing.
Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  tracesSampleRate: 0,
  beforeSend: scrubTokens,
});

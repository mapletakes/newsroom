import * as Sentry from '@sentry/nextjs';
import { scrubTokens } from '@/lib/sentry-scrub';

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  tracesSampleRate: 0,
  beforeSend: scrubTokens,
});

import { withSentryConfig } from '@sentry/nextjs';

// Surgical security headers. Deliberately NOT a full Content-Security-Policy:
// only `frame-ancestors` is set (anti-clickjacking) so we don't break YouTube
// embeds, remote thumbnails, the Supabase realtime socket, or the inline theme
// script. Permissions-Policy only locks down clearly-unused features so the
// YouTube embed's autoplay/picture-in-picture still work.
const securityHeaders = [
  {
    key: 'Strict-Transport-Security',
    value: 'max-age=63072000; includeSubDomains; preload',
  },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Content-Security-Policy', value: "frame-ancestors 'none'" },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
];

/** @type {import('next').NextConfig} */
const nextConfig = {
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: '**' },
    ],
  },
  async headers() {
    return [{ source: '/:path*', headers: securityHeaders }];
  },
};

export default withSentryConfig(nextConfig, {
  // Silences the "no auth token, skipping source map upload" notice when
  // SENTRY_AUTH_TOKEN isn't set — errors still report fine without it, you
  // just get minified stack traces instead of the original source.
  silent: true,
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  authToken: process.env.SENTRY_AUTH_TOKEN,
  disableLogger: true,
  telemetry: false,
});

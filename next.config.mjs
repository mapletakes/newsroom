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

// Archived snapshots (/a/<id>, app/a/[id]/route.ts) are someone else's HTML
// served from our domain, so they get a far stricter policy that makes them
// inert even if lib/archive-freeze.ts missed something:
//  - `sandbox` without allow-scripts / allow-same-origin: no script runs, and
//    the document gets an opaque origin, so it can't read our cookies or call
//    our API as the viewer;
//  - `default-src 'none'` with data: only for images, fonts and media: the
//    page can't load anything from the network (no tracking pixels, nothing
//    that leaks the viewer's IP to the original site);
//  - popups may escape the sandbox so target=_blank links still open.
// This has to live here rather than in the route: config headers override a
// route handler's own headers of the same name.
const snapshotHeaders = [
  {
    key: 'Content-Security-Policy',
    value: [
      'sandbox allow-popups allow-popups-to-escape-sandbox allow-top-navigation-by-user-activation',
      "default-src 'none'",
      'img-src data:',
      'font-src data:',
      'media-src data:',
      "style-src 'unsafe-inline'",
      "form-action 'none'",
      "base-uri 'none'",
      "frame-ancestors 'none'",
    ].join('; '),
  },
  { key: 'Referrer-Policy', value: 'no-referrer' },
  { key: 'X-Robots-Tag', value: 'noindex, nofollow' },
];

/** @type {import('next').NextConfig} */
const nextConfig = {
  // No remotePatterns: thumbnails come from arbitrary submitted/publisher
  // URLs (OG-scraped) and are always rendered as plain <img>, never through
  // next/image's <Image> component — so there's no legitimate use of the
  // /_next/image optimizer route here, and leaving remotePatterns empty
  // keeps that route from being usable as an open image-fetch proxy.
  async headers() {
    // Order matters: for the same header key, the later matching entry wins.
    return [
      { source: '/:path*', headers: securityHeaders },
      { source: '/a/:id', headers: snapshotHeaders },
    ];
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

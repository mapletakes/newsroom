// The add token doubles as a bearer credential for quick-add/segments/overlay
// (see lib/ratelimit.ts) and shows up in plain query strings and the
// X-Add-Token header — strip it before an event ever leaves the process so a
// crash report can't leak a live token to Sentry.
//
// Loosely typed (not imported from @sentry/nextjs) so this doesn't depend on
// matching the exact event-shape type name across SDK versions; it only reads
// the handful of fields it scrubs.
interface ScrubbableEvent {
  request?: {
    url?: string;
    query_string?: string | Array<{ key: string; value: string }>;
    headers?: Record<string, string>;
  };
  breadcrumbs?: Array<{ data?: Record<string, unknown> }>;
}

const redactUrl = (url?: string) =>
  url ? url.replace(/([?&](?:token|add_token)=)[^&]*/gi, '$1REDACTED') : url;

export function scrubTokens<T extends ScrubbableEvent>(event: T): T {
  if (event.request) {
    event.request.url = redactUrl(event.request.url);
    if (typeof event.request.query_string === 'string') {
      event.request.query_string = event.request.query_string.replace(
        /((?:^|&)(?:token|add_token)=)[^&]*/gi,
        '$1REDACTED',
      );
    }
    if (event.request.headers) {
      for (const key of Object.keys(event.request.headers)) {
        if (key.toLowerCase() === 'x-add-token') event.request.headers[key] = 'REDACTED';
      }
    }
  }
  for (const crumb of event.breadcrumbs || []) {
    if (typeof crumb.data?.url === 'string') crumb.data.url = redactUrl(crumb.data.url);
  }
  return event;
}

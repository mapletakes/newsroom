import type * as Sentry from '@sentry/nextjs';

// The add token doubles as a bearer credential for quick-add/segments/overlay
// (see lib/ratelimit.ts) and shows up in plain query strings and the
// X-Add-Token header — strip it before an event ever leaves the process so a
// crash report can't leak a live token to Sentry.
//
// Derived from Sentry.init's own parameter type (rather than importing a
// named event type) so this can't drift from whatever shape the installed
// SDK version actually expects for beforeSend.
type InitOptions = NonNullable<Parameters<typeof Sentry.init>[0]>;
type BeforeSend = NonNullable<InitOptions['beforeSend']>;
type ErrorEvent = Parameters<BeforeSend>[0];

const SECRET_KEYS = new Set(['token', 'add_token']);

const redactUrl = (url?: string) =>
  url ? url.replace(/([?&](?:token|add_token)=)[^&]*/gi, '$1REDACTED') : url;

function redactQueryParams(qs: NonNullable<ErrorEvent['request']>['query_string']) {
  if (typeof qs === 'string') {
    return qs.replace(/((?:^|&)(?:token|add_token)=)[^&]*/gi, '$1REDACTED');
  }
  if (Array.isArray(qs)) {
    return qs.map((p) => (SECRET_KEYS.has(p.key.toLowerCase()) ? { ...p, value: 'REDACTED' } : p));
  }
  if (qs) {
    const redacted = { ...qs };
    for (const key of Object.keys(redacted)) {
      if (SECRET_KEYS.has(key.toLowerCase())) redacted[key] = 'REDACTED';
    }
    return redacted;
  }
  return qs;
}

export function scrubTokens(event: ErrorEvent): ErrorEvent {
  if (event.request) {
    event.request.url = redactUrl(event.request.url);
    event.request.query_string = redactQueryParams(event.request.query_string);
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

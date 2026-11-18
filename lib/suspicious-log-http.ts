// Response helpers shared by the suspicious-log API routes.

import { NextResponse } from 'next/server';
import type { LogDenied } from './suspicious-log-access';

const DENIED_STATUS: Record<LogDenied, number> = {
  unauthenticated: 401,
  forbidden: 403,
  reconnect: 403,
  twitch: 503,
};

// Never cached: the answer depends on who is asking and on a live Twitch check.
export const reply = (body: unknown, status = 200) =>
  NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store' } });

export const denied = (reason: LogDenied) => reply({ error: reason }, DENIED_STATUS[reason]);

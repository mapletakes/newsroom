// Token-authed quick-add target for the bookmarklet / extension.
// Opened as a small popup: ?token=...&url=... → adds to the deck and
// shows a tiny auto-closing confirmation.

import { NextRequest } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { addToDeck } from '@/lib/deck-add';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function page(inner: string, autoClose = false): Response {
  const body = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>The Broadside</title></head><body style="font-family:ui-sans-serif,system-ui,sans-serif;margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#f7f4ee;color:#16151a"><div style="text-align:center;padding:28px;max-width:380px">${inner}</div>${
    autoClose ? '<script>setTimeout(function(){window.close();},1200);</script>' : ''
  }</body></html>`;
  return new Response(body, {
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get('token') || '';
  const url = req.nextUrl.searchParams.get('url') || '';

  if (!token || !url) {
    return page('<h2 style="margin:0">Missing token or URL</h2>');
  }

  const sb = supabaseAdmin();
  const { data: stream } = await sb
    .from('streams')
    .select('id, twitch_login')
    .eq('add_token', token)
    .maybeSingle();

  if (!stream) {
    return page(
      '<h2 style="margin:0 0 8px">Invalid add link</h2><p style="opacity:.6;font-size:14px">Regenerate it in The Broadside → Settings.</p>',
    );
  }

  const result = await addToDeck(stream.id, url, stream.twitch_login);
  if (!result.ok) {
    return page(
      `<h2 style="margin:0 0 8px">Couldn't add</h2><p style="opacity:.6;font-size:14px">${escapeHtml(result.error || 'Please try again.')}</p>`,
    );
  }

  const label = result.expanded
    ? `Added ${result.count} videos from playlist`
    : 'Added to your deck';
  return page(
    `<div style="font-size:40px;line-height:1">✓</div><h2 style="margin:8px 0 6px">${label}</h2><p style="opacity:.55;font-size:13px;word-break:break-all">${escapeHtml(url)}</p>`,
    true,
  );
}

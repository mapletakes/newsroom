import { NextRequest } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { ARCHIVE_BUCKET, ARCHIVE_SLUG_RE } from '@/lib/archive';

export const dynamic = 'force-dynamic';

// Public snapshot viewer. The sandboxing Content-Security-Policy, no-referrer
// and noindex headers are set for /a/:id in next.config.mjs — config headers
// override a route handler's own, so they can't be set from here.

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!ARCHIVE_SLUG_RE.test(id)) return notFound();

  const { data, error } = await supabaseAdmin().storage.from(ARCHIVE_BUCKET).download(`${id}.html`);
  if (error || !data) return notFound();

  return new Response(data.stream(), {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      // Snapshots never change once written, but a takedown deletes one, so
      // the CDN copy is kept to a day rather than forever.
      'Cache-Control': 'public, max-age=3600, s-maxage=86400',
    },
  });
}

function notFound() {
  return new Response('Snapshot not found.', {
    status: 404,
    headers: { 'Content-Type': 'text/plain; charset=utf-8', 'X-Robots-Tag': 'noindex' },
  });
}

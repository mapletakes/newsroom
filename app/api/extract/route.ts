import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { extractArticle } from '@/lib/extract-article';
import { fetchYouTubeMeta, expandPlaylist } from '@/lib/extract-youtube';
import { enrichContent, hostDMCARisk } from '@/lib/enrich';
import { detectKind, normalizeUrl } from '@/lib/url';

export const maxDuration = 30;

export async function POST(req: NextRequest) {
  const body = await req.json();
  const submissionId = String(body.submissionId || '');
  if (!submissionId) return NextResponse.json({ error: 'missing submissionId' }, { status: 400 });

  const sb = supabaseAdmin();
  const { data: sub, error } = await sb
    .from('submissions')
    .select('*')
    .eq('id', submissionId)
    .single();
  if (error || !sub) return NextResponse.json({ error: 'not found' }, { status: 404 });

  try {
    let title: string | null = null;
    let description: string | null = null;
    let thumbnail: string | null = null;
    let publisher: string | null = null;
    let author: string | null = null;
    let publishedAt: string | null = null;
    let duration: number | null = null;
    let bodyText: string | null = null;

    if (sub.kind === 'youtube' || sub.kind === 'youtube_short') {
      const meta = await fetchYouTubeMeta(sub.url);
      title = meta.title;
      description = meta.description;
      thumbnail = meta.thumbnail;
      publisher = meta.publisher;
      publishedAt = meta.publishedAt;
      duration = meta.durationSeconds;
      bodyText = [meta.description, meta.transcript].filter(Boolean).join('\n\n');
    } else if (sub.kind === 'youtube_playlist') {
      // Expand the playlist into individual pending submissions, then mark this one rejected
      const urls = await expandPlaylist(sub.url);
      for (const u of urls) {
        await sb.from('submissions').upsert(
          {
            stream_id: sub.stream_id,
            url: u,
            normalized_url: normalizeUrl(u),
            kind: detectKind(u),
            status: 'pending',
            submitter_login: sub.submitter_login,
            mod_notes: `expanded from playlist`,
          },
          { onConflict: 'stream_id,normalized_url', ignoreDuplicates: true },
        );
      }
      await sb.from('submissions').update({
        status: 'rejected',
        mod_notes: `expanded into ${urls.length} item(s)`,
      }).eq('id', sub.id);
      return NextResponse.json({ ok: true, expanded: urls.length });
    } else {
      // articles, twitter, twitch, tiktok, unknown — grab OG/SEO meta tags
      const meta = await extractArticle(sub.url);
      title = meta.title;
      description = meta.description;
      thumbnail = meta.thumbnail;
      publisher = meta.publisher;
      author = meta.author;
      publishedAt = meta.publishedAt;
      bodyText = meta.description;
    }

    // Enrich
    const enriched = await enrichContent({
      url: sub.url,
      title,
      publisher,
      body: bodyText,
    });

    const patch = {
      title,
      description,
      thumbnail_url: thumbnail,
      publisher,
      author,
      published_at: publishedAt,
      duration_seconds: duration,
      summary: enriched.summary,
      credibility_tag: enriched.credibility,
      topics: enriched.topics,
      dmca_risk: enriched.dmcaRisk || hostDMCARisk(sub.url),
    };
    await sb.from('submissions').update(patch).eq('id', sub.id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error(err);
    // Still set a host-based DMCA risk even if extraction failed
    await sb.from('submissions').update({
      dmca_risk: hostDMCARisk(sub.url),
      mod_notes: 'extraction failed',
    }).eq('id', sub.id);
    return NextResponse.json({ error: 'extraction failed' }, { status: 500 });
  }
}

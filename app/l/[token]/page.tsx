import Link from 'next/link';
import { notFound } from 'next/navigation';
import { supabaseAdmin } from '@/lib/supabase';
import { getSession } from '@/lib/session';
import { Wordmark } from '@/components/ui/wordmark';
import { Badge } from '@/components/ui/badge';
import { formatDuration, formatDate, kindTint } from '@/lib/url';
import { cn } from '@/lib/utils';
import { ImportButton } from './ImportButton';

export const dynamic = 'force-dynamic';

export async function generateMetadata({ params }: { params: { token: string } }) {
  const sb = supabaseAdmin();
  const { data: list } = await sb.from('lists').select('name').eq('share_token', params.token).maybeSingle();
  return { title: list ? `${list.name} — The Broadside` : 'Clip file — The Broadside' };
}

export default async function SharedListPage({ params }: { params: { token: string } }) {
  const sb = supabaseAdmin();
  const { data: list } = await sb
    .from('lists')
    .select('id, name, updated_at, stream_id')
    .eq('share_token', params.token)
    .maybeSingle();
  if (!list) notFound();

  const [{ data: stream }, { data: items }, session] = await Promise.all([
    sb.from('streams').select('display_name, twitch_login').eq('id', list.stream_id).maybeSingle(),
    sb
      .from('list_items')
      .select('id, url, kind, title, description, thumbnail_url, publisher, duration_seconds, published_at, summary, credibility_tag, topics, dmca_risk, content_warning, note')
      .eq('list_id', list.id)
      .order('position', { ascending: true })
      .order('created_at', { ascending: true }),
    getSession(),
  ]);
  const streamerName = stream?.display_name || stream?.twitch_login || 'A streamer';

  return (
    <main className="min-h-screen px-6 py-10 max-w-3xl mx-auto">
      <header className="mb-8 flex items-center gap-3 flex-wrap">
        <Wordmark />
        <span className="font-mono text-xs uppercase tracking-widest text-ink/60">/ shared clip file</span>
        <Link href="/" className="ml-auto underline hover:text-rust font-mono text-xs uppercase tracking-widest">
          The Broadside →
        </Link>
      </header>

      <p className="font-mono text-xs uppercase tracking-widest text-ink/50 mb-2">
        Shared by <strong className="text-ink">{streamerName}</strong>
      </p>
      <h1 className="font-display text-4xl font-bold mb-2">{list.name}</h1>
      <p className="font-mono text-xs text-ink/50 mb-6">
        {(items || []).length} item{(items || []).length === 1 ? '' : 's'} · read-only — this is a snapshot,
        not a live view of {streamerName}&apos;s clip file
      </p>

      <div className="mb-8">
        <ImportButton token={params.token} loggedIn={!!session} />
      </div>

      <div className="rule-double mb-6" />

      {(items || []).length === 0 ? (
        <p className="text-ink/60 font-mono text-sm py-8 text-center">This clip file is empty.</p>
      ) : (
        <div className="space-y-3">
          {(items || []).map((item) => (
            <article key={item.id} className={cn(kindTint(item.kind), 'card-paper p-4 flex gap-3')}>
              {item.thumbnail_url && (
                <img
                  src={item.thumbnail_url}
                  alt=""
                  className="shrink-0 w-28 h-[4.5rem] object-cover border border-ink/20"
                  loading="lazy"
                />
              )}
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 mb-1 flex-wrap font-mono text-xs uppercase tracking-widest">
                  <Badge variant="outline">{item.kind.replace('_', ' ')}</Badge>
                  {item.duration_seconds ? <span className="text-ink/60">{formatDuration(item.duration_seconds)}</span> : null}
                  {item.credibility_tag && <Badge variant="outline">{item.credibility_tag}</Badge>}
                  {item.content_warning && <span className="text-rust font-bold">⚠ CW</span>}
                </div>
                <a href={item.url} target="_blank" rel="noreferrer" className="hover:text-rust">
                  <div className="font-display text-lg font-bold leading-tight mb-1">{item.title || item.url}</div>
                </a>
                <div className="font-mono text-xs text-ink/50 mb-1">
                  {item.publisher}
                  {item.published_at && ` · ${formatDate(item.published_at)}`}
                </div>
                {(item.summary || item.description) && (
                  <p className="text-sm text-ink/70 leading-snug line-clamp-2 mb-1">{item.summary || item.description}</p>
                )}
                {item.note && (
                  <div className="border-l-2 border-ochre bg-ochre/10 px-3 py-1.5 text-sm mt-1">{item.note}</div>
                )}
              </div>
            </article>
          ))}
        </div>
      )}
    </main>
  );
}

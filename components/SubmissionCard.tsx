'use client';

type Submission = {
  id: string;
  url: string;
  kind: string;
  status: string;
  title: string | null;
  thumbnail_url: string | null;
  publisher: string | null;
  summary: string | null;
  credibility_tag: string | null;
  topics: string[] | null;
  dmca_risk: string | null;
  submitter_login: string | null;
  submitter_is_sub: boolean | null;
  submitter_is_mod: boolean | null;
  submitter_is_vip: boolean | null;
  created_at: string;
};

const KIND_LABELS: Record<string, string> = {
  article: 'Article',
  youtube: 'YouTube',
  youtube_short: 'YT Short',
  youtube_playlist: 'YT Playlist',
  twitch_clip: 'Twitch Clip',
  twitch_vod: 'Twitch VOD',
  twitter: 'X / Twitter',
  tiktok: 'TikTok',
  unknown: 'Link',
};

const RISK_LABELS: Record<string, string> = {
  high: '⚠ High DMCA risk',
  medium: '◐ Medium DMCA risk',
  low: '○ Low DMCA risk',
};

export function SubmissionCard({
  s,
  compact = false,
  actions,
}: {
  s: Submission;
  compact?: boolean;
  actions?: React.ReactNode;
}) {
  const host = (() => {
    try { return new URL(s.url).hostname.replace(/^www\./, ''); } catch { return ''; }
  })();

  return (
    <article className={`card-paper ${compact ? 'p-3' : 'p-4'} flex gap-4`}>
      {s.thumbnail_url && (
        <img
          src={s.thumbnail_url}
          alt=""
          className={`${compact ? 'w-24 h-16' : 'w-40 h-24'} object-cover border border-ink/20 shrink-0`}
          loading="lazy"
        />
      )}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-1 flex-wrap">
          <span className="font-mono text-[10px] uppercase tracking-widest bg-ink text-paper px-1.5 py-0.5">
            {KIND_LABELS[s.kind] || s.kind}
          </span>
          {s.credibility_tag && (
            <span className="font-mono text-[10px] uppercase tracking-widest border border-ink/40 px-1.5 py-0.5">
              {s.credibility_tag}
            </span>
          )}
          {s.dmca_risk && (
            <span className={`font-mono text-[10px] uppercase tracking-widest dmca-${s.dmca_risk}`}>
              {RISK_LABELS[s.dmca_risk]}
            </span>
          )}
        </div>
        <h3 className={`font-display ${compact ? 'text-base' : 'text-lg'} font-bold leading-tight mb-1`}>
          {s.title || s.url}
        </h3>
        <div className="font-mono text-[11px] text-ink/60 mb-2 truncate">
          {s.publisher || host}
          {s.submitter_login && (
            <> · submitted by <strong>{s.submitter_login}</strong>
              {s.submitter_is_mod ? ' (mod)' : s.submitter_is_vip ? ' (vip)' : s.submitter_is_sub ? ' (sub)' : ''}
            </>
          )}
        </div>
        {!compact && s.summary && (
          <p className="text-sm leading-relaxed mb-2">{s.summary}</p>
        )}
        {!compact && s.topics && s.topics.length > 0 && (
          <div className="flex flex-wrap gap-1 mb-2">
            {s.topics.map((t) => (
              <span key={t} className="font-mono text-[10px] uppercase bg-paper border border-ink/30 px-1.5 py-0.5">
                #{t}
              </span>
            ))}
          </div>
        )}
        {actions && <div className="mt-2 flex gap-2 flex-wrap">{actions}</div>}
      </div>
    </article>
  );
}

export type { Submission };

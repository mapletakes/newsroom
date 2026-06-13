'use client';

import { formatDuration, formatDate, formatDateTime, relativeTime, kindTint } from '@/lib/url';
import { ArchiveButton } from './ArchiveButton';

type Submission = {
  id: string;
  url: string;
  kind: string;
  status: string;
  title: string | null;
  thumbnail_url: string | null;
  publisher: string | null;
  author: string | null;
  duration_seconds: number | null;
  published_at: string | null;
  description: string | null;
  summary: string | null;
  credibility_tag: string | null;
  topics: string[] | null;
  dmca_risk: string | null;
  related_coverage: { title: string; url: string; publisher: string; snippet: string }[] | null;
  archive_url: string | null;
  mod_notes: string | null;
  segment_id: string | null;
  position: number | null;
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

// Tint the capture age so stale (e.g. overnight) items stand out.
function captureAgeClass(createdAt: string): string {
  const hours = (Date.now() - new Date(createdAt).getTime()) / 3_600_000;
  if (hours >= 24) return 'text-rust font-bold';
  if (hours >= 6) return 'text-ochre';
  return 'text-ink/45';
}

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
    <article className={`card-paper ${kindTint(s.kind)} ${compact ? 'p-3' : 'p-4'} flex gap-4`}>
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
          <span className="font-mono text-xs uppercase tracking-widest bg-ink text-paper px-1.5 py-0.5">
            {KIND_LABELS[s.kind] || s.kind}
          </span>
          {s.duration_seconds ? (
            <span className="font-mono text-xs uppercase tracking-widest text-ink/60">
              {formatDuration(s.duration_seconds)}
            </span>
          ) : null}
          {s.credibility_tag && (
            <span className="font-mono text-xs uppercase tracking-widest border border-ink/40 px-1.5 py-0.5">
              {s.credibility_tag}
            </span>
          )}
          {s.dmca_risk && (
            <span className={`font-mono text-xs uppercase tracking-widest dmca-${s.dmca_risk}`}>
              {RISK_LABELS[s.dmca_risk]}
            </span>
          )}
        </div>
        <h3 className={`font-display ${compact ? 'text-lg' : 'text-xl'} font-bold leading-tight mb-1`}>
          {s.title || s.url}
        </h3>
        <div className="font-mono text-xs text-ink/60 mb-1 truncate">
          {s.publisher || host}
          {s.published_at && ` · ${formatDate(s.published_at)}`}
          {s.submitter_login && (
            <> · submitted by <strong>{s.submitter_login}</strong>
              {s.submitter_is_mod ? ' (mod)' : s.submitter_is_vip ? ' (vip)' : s.submitter_is_sub ? ' (sub)' : ''}
            </>
          )}
        </div>
        <div className="font-mono text-xs mb-2">
          <span className="text-ink/45">Captured {formatDateTime(s.created_at)} · </span>
          <span className={captureAgeClass(s.created_at)}>{relativeTime(s.created_at)}</span>
        </div>
        {!compact && (s.summary || s.description) && (
          <p className="text-base leading-relaxed mb-2 whitespace-pre-line">
            {s.summary || s.description}
          </p>
        )}
        {!compact && s.topics && s.topics.length > 0 && (
          <div className="flex flex-wrap gap-1 mb-2">
            {s.topics.map((t) => (
              <span key={t} className="font-mono text-xs uppercase bg-paper border border-ink/30 px-1.5 py-0.5">
                #{t}
              </span>
            ))}
          </div>
        )}
        <div className="mt-1">
          <ArchiveButton id={s.id} archiveUrl={s.archive_url} />
        </div>
        {actions && <div className="mt-2 flex gap-2 flex-wrap">{actions}</div>}
      </div>
    </article>
  );
}

export type { Submission };

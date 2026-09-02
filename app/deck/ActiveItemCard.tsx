'use client';

// The "active card" pane — everything shown for whatever's currently on air:
// badges, title, trigger warning, summary, mod note, embed/thumbnail,
// topics, related coverage, and the action-button row + takeaway box.
// Presentational — every closure DeckView used to hold (markPlayed, skip,
// rejectActive, announce, saveTriggerWarning, takeaway/pinOnAnnounce state)
// comes in as a prop instead. Split out of DeckView.tsx as a structural
// move only; no rendered output changed.

import type { Submission } from '@/components/SubmissionCard';
import { extractYouTubeId, formatDuration, formatDate, formatClock } from '@/lib/url';
import { ArchiveButton } from '@/components/ArchiveButton';
import { Icon } from '@/components/ui/icon';
import { SaveToListMenu } from '@/components/SaveToListMenu';
import { TriggerWarningBanner, TriggerWarningEditor } from '@/components/TriggerWarning';
import { Button, buttonVariants } from '@/components/ui/button';
import { Textarea } from '@/components/ui/input';
import { SimpleTooltip } from '@/components/ui/tooltip';
import { Badge } from '@/components/ui/badge';

export function ActiveItemCard({
  active,
  elapsedSeconds,
  curateOnly,
  takeaway,
  onTakeawayChange,
  pinOnAnnounce,
  onPinOnAnnounceChange,
  onMarkPlayed,
  onSkip,
  onReject,
  onAnnounce,
  onSaveTriggerWarning,
}: {
  active: Submission | null;
  elapsedSeconds: number;
  curateOnly: boolean;
  takeaway: string;
  onTakeawayChange: (value: string) => void;
  pinOnAnnounce: boolean;
  onPinOnAnnounceChange: (value: boolean) => void;
  onMarkPlayed: () => void;
  onSkip: () => void;
  onReject: () => void;
  onAnnounce: () => void;
  onSaveTriggerWarning: (id: string, value: string | null) => void;
}) {
  if (!active) return null;

  const embedYouTube =
    active.kind === 'youtube' || active.kind === 'youtube_short' ? extractYouTubeId(active.url) : null;

  return (
    <article>
      <div className="flex items-center gap-2 mb-3 flex-wrap font-mono text-xs uppercase tracking-widest">
        <Badge size="default">{active.kind.replace('_', ' ')}</Badge>
        {active.duration_seconds ? (
          <Badge variant="outlineStrong" size="default">{formatDuration(active.duration_seconds)}</Badge>
        ) : null}
        {active.credibility_tag && (
          <Badge variant="outlineStrong" size="default">{active.credibility_tag}</Badge>
        )}
        {active.dmca_risk === 'high' && (
          <Badge variant="destructive" size="default">⚠ High DMCA risk</Badge>
        )}
        {active.dmca_risk === 'medium' && (
          <Badge variant="warning" size="default">◐ Medium risk</Badge>
        )}
        {active.content_warning && (
          <SimpleTooltip content={active.content_warning}>
            <Badge variant="destructive" size="default" className="cursor-default">
              ⚠ Content warning
            </Badge>
          </SimpleTooltip>
        )}
        {active.publisher && <span className="text-ink/60">· {active.publisher}</span>}
        {active.published_at && <span className="text-ink/60">· {formatDate(active.published_at)}</span>}
        <span className="ml-auto flex items-center gap-3 normal-case tracking-normal">
          <span className="flex items-center gap-1.5 font-mono text-rust font-bold tracking-widest uppercase" title="Time on air for this item">
            <span className="inline-block w-1.5 h-1.5 rounded-full bg-rust live-dot" />
            {formatClock(elapsedSeconds)}
          </span>
          <ArchiveButton id={active.id} url={active.url} archiveUrl={active.archive_url} />
        </span>
      </div>

      <h1 className="font-display text-3xl lg:text-4xl font-black leading-tight mb-4">
        {active.title || active.url}
      </h1>

      {/* Directly under the headline and above everything else on the
          item — this is what's on the overlay right now, and what's
          going out with the next chat post. */}
      <div className="max-w-3xl mb-6 flex flex-col gap-2 items-start">
        {active.trigger_warning && <TriggerWarningBanner text={active.trigger_warning} className="w-full" />}
        <TriggerWarningEditor
          key={active.id}
          value={active.trigger_warning}
          onSave={(v) => onSaveTriggerWarning(active.id, v)}
        />
      </div>

      {(active.summary || active.description) && (
        <p className="text-lg leading-relaxed mb-6 max-w-3xl whitespace-pre-line">
          {active.summary || active.description}
        </p>
      )}

      {active.mod_notes && (
        <div className="max-w-3xl mb-6 border-l-4 border-ochre bg-ochre/10 px-4 py-3">
          <span className="font-mono text-xs uppercase tracking-widest text-ochre block mb-1">
            Mod note
          </span>
          <span className="text-sm">{active.mod_notes}</span>
        </div>
      )}

      {embedYouTube && (
        <div className="aspect-video bg-ink mb-6 max-w-3xl">
          <iframe
            src={`https://www.youtube.com/embed/${embedYouTube}`}
            className="w-full h-full"
            allowFullScreen
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
          />
        </div>
      )}

      {active.kind === 'article' && active.thumbnail_url && (
        <img
          src={active.thumbnail_url}
          alt=""
          className="max-w-3xl border border-ink/20 mb-6"
        />
      )}

      {active.topics && active.topics.length > 0 && (
        <div className="flex flex-wrap gap-1 mb-6">
          {active.topics.map((t) => (
            <span
              key={t}
              className="font-mono text-xs uppercase bg-paper border border-ink/30 px-2 py-1"
            >
              #{t}
            </span>
          ))}
        </div>
      )}

      {active.related_coverage &&
        Array.isArray(active.related_coverage) &&
        active.related_coverage.length > 0 && (
          <div className="mb-6 max-w-3xl">
            <div className="rule-double mb-3" />
            <h2 className="font-mono text-xs uppercase tracking-widest text-ink/60 mb-3">
              Related coverage ({active.related_coverage.length})
            </h2>
            <div className="space-y-2">
              {active.related_coverage.map((c, i) => (
                <a
                  key={i}
                  href={c.url}
                  target="_blank"
                  rel="noreferrer"
                  className="block card-paper p-3 hover:border-ink"
                >
                  <div className="font-display text-sm font-bold leading-tight mb-1">
                    {c.title}
                  </div>
                  <div className="font-mono text-xs uppercase tracking-widest text-ink/60 mb-1">
                    {c.publisher}
                  </div>
                  {c.snippet && (
                    <div className="text-xs text-ink/70 leading-relaxed line-clamp-2">
                      {c.snippet}
                    </div>
                  )}
                </a>
              ))}
            </div>
            <div className="rule-double mt-3" />
          </div>
        )}

      <div className="flex gap-3 flex-wrap mb-6">
        <a href={active.url} target="_blank" rel="noreferrer" className={buttonVariants()}>
          Open source ↗
        </a>
        {!curateOnly && (
          <Button variant="moss" onClick={onMarkPlayed}>
            ✓ Played — next
          </Button>
        )}
        {!curateOnly && (
          <Button variant="outline" onClick={onSkip}>
            Skip
          </Button>
        )}
        <Button variant="outlineDestructive" onClick={onReject} title="Remove from deck">
          <Icon name="remove" className="text-base" />
          Remove
        </Button>
        {!curateOnly && (
          <>
            <Button
              variant="outline"
              onClick={onAnnounce}
              title={
                pinOnAnnounce
                  ? "Post 'Watching: …' to your chat and pin it for 20 minutes"
                  : "Post 'Watching: …' to your chat so a mod can pin it"
              }
            >
              <Icon name="announce" className="text-base" />
              Post to chat
            </Button>
            <label
              className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-widest text-ink/60 cursor-pointer self-center"
              title="Pins the message for 20 minutes and replaces whatever's currently pinned. Needs your Twitch account reconnected since this was added — if it's not, the post fails outright rather than sending unpinned."
            >
              <input
                type="checkbox"
                checked={pinOnAnnounce}
                onChange={(e) => onPinOnAnnounceChange(e.target.checked)}
              />
              Pin
            </label>
          </>
        )}
        <SaveToListMenu
          trigger={
            <Button variant="outline">
              <Icon name="bookmark" className="text-base" />
              Save to…
            </Button>
          }
          onSave={async (listId) => {
            const r = await fetch(`/api/lists/${listId}/items`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ submissionId: active.id }),
            });
            if (!r.ok) return { ok: false };
            const data = await r.json();
            return { ok: true, added: data.added, skipped: data.skipped };
          }}
        />
      </div>

      {!curateOnly && (
        <label className="block max-w-3xl">
          <span className="font-mono text-xs uppercase tracking-widest text-ink/60">
            Takeaway for show notes (optional)
          </span>
          <Textarea
            value={takeaway}
            onChange={(e) => onTakeawayChange(e.target.value)}
            rows={3}
            className="w-full mt-1"
            placeholder="Add a one-liner about what you said about this on stream..."
          />
        </label>
      )}
    </article>
  );
}

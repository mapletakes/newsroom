'use client';

import { useState } from 'react';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { MAX_TITLE_OVERRIDE_CHARS } from '@/lib/title-override';

/**
 * Set / edit / reset the title viewers see for an item — on the overlay and
 * in the "Watching:" chat post. The item's own scraped title is untouched
 * (it's still what the deck, queue and show notes show), so this is always
 * reversible with "Use original".
 *
 * Presentational only, same contract as TriggerWarningEditor: persistence is
 * the caller's. `value` seeds the draft once on mount, so callers showing a
 * changeable item should key this by submission id. `onSave` may report
 * failure by returning `{ ok: false }`, which keeps the editor open.
 */
export function TitleOverrideEditor({
  value,
  originalTitle,
  onSave,
}: {
  value: string | null;
  /** The scraped title — shown as the placeholder and as what "Use original" restores. */
  originalTitle: string | null;
  onSave: (value: string | null) => Promise<{ ok?: boolean } | void> | void;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(value || '');
  const [saving, setSaving] = useState(false);

  const trimmed = draft.trim();
  const dirty = trimmed !== (value || '').trim();

  const commit = async (next: string | null) => {
    setSaving(true);
    try {
      const result = await onSave(next);
      if (!result || result.ok !== false) setOpen(false);
    } catch {
      /* left open — the caller reports the failure in its own surface */
    } finally {
      setSaving(false);
    }
  };

  if (!open) {
    return (
      <div className="flex flex-col gap-1 items-start">
        {value && (
          <p className="font-mono text-xs text-ink/70">
            <span className="uppercase tracking-widest text-ink/50">Viewers see: </span>
            <span className="font-bold">{value}</span>
          </p>
        )}
        <button
          type="button"
          onClick={() => {
            setDraft(value || '');
            setOpen(true);
          }}
          className="self-start font-mono text-xs uppercase tracking-widest text-ink/60 hover:text-ink"
        >
          {value ? '✎ edit overlay/chat title' : '+ override overlay/chat title'}
        </button>
      </div>
    );
  }

  return (
    <div className="w-full flex flex-col gap-1.5">
      <span className="font-mono text-xs uppercase tracking-widest text-ink/60 font-bold">
        Overlay &amp; chat title
      </span>
      <Input
        autoFocus
        value={draft}
        maxLength={MAX_TITLE_OVERRIDE_CHARS}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && trimmed && dirty && !saving) {
            e.preventDefault();
            commit(trimmed);
          }
          if (e.key === 'Escape') setOpen(false);
        }}
        placeholder={originalTitle || 'Title shown to viewers'}
        className="w-full text-sm"
        aria-label="Overlay and chat title"
      />
      <p className="font-mono text-[10px] text-ink/50">
        Replaces the title on the overlay and in the “Watching:” chat post. The link, and the title
        shown here on the deck, are unchanged.
      </p>
      <div className="flex gap-2 flex-wrap">
        <Button
          type="button"
          size="xs"
          disabled={saving || !trimmed || !dirty}
          onClick={() => commit(trimmed)}
        >
          {saving ? 'Saving…' : 'Save title'}
        </Button>
        <Button type="button" variant="outline" size="xs" disabled={saving} onClick={() => setOpen(false)}>
          Cancel
        </Button>
        {value && (
          <Button
            type="button"
            variant="ghost"
            size="xs"
            disabled={saving}
            onClick={() => {
              setDraft('');
              commit(null);
            }}
            className="ml-auto text-ink/60"
          >
            Use original
          </Button>
        )}
      </div>
    </div>
  );
}

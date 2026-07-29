'use client';

import { useState } from 'react';
import { Button } from './ui/button';
import { Textarea } from './ui/input';
import { cn } from '@/lib/utils';

// Roughly what survives the chat-message budget (see MAX_TW_CHARS in
// lib/announce.ts) — enforced here too so the author finds out they're being
// truncated while writing, not after it's posted.
export const MAX_TRIGGER_WARNING_CHARS = 180;

/**
 * Read-only banner for an item's trigger warning.
 *
 * Rust-on-paper with a solid bar, deliberately louder than the ochre mod-note
 * block next to it on the deck: a mod note is a production aside, this is the
 * thing that has to be noticed before the item goes on screen.
 */
export function TriggerWarningBanner({
  text,
  className,
}: {
  text: string;
  className?: string;
}) {
  return (
    <div className={cn('border-l-4 border-rust bg-rust/15 px-4 py-3', className)}>
      <span className="font-mono text-xs uppercase tracking-widest text-rust font-bold block mb-1">
        ⚠ Trigger warning
      </span>
      <span className="text-sm">{text}</span>
    </div>
  );
}

/**
 * Add / edit / clear an item's trigger warning.
 *
 * Presentational only — persistence is the caller's, since the deck and the
 * mod view reach the same PATCH through very different machinery (the deck's
 * pendingWrites reconciliation vs. the mod view's row mutation). `value` seeds
 * the draft once on mount, so callers showing a changeable item should key
 * this component by submission id rather than expect it to follow the prop.
 *
 * `onSave` may report failure by returning `{ ok: false }` (neither caller
 * throws — both surface errors their own way). The editor stays open in that
 * case, so a warning that didn't save doesn't look like one that did.
 */
export function TriggerWarningEditor({
  value,
  onSave,
  label = 'Trigger warning',
}: {
  value: string | null;
  onSave: (value: string | null) => Promise<{ ok?: boolean } | void> | void;
  label?: string;
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
      <button
        type="button"
        onClick={() => {
          setDraft(value || '');
          setOpen(true);
        }}
        className="self-start font-mono text-xs uppercase tracking-widest text-rust/80 hover:text-rust"
      >
        {value ? '✎ edit trigger warning' : '+ add trigger warning'}
      </button>
    );
  }

  return (
    <div className="w-full flex flex-col gap-1.5">
      <span className="font-mono text-xs uppercase tracking-widest text-rust font-bold">
        ⚠ {label}
      </span>
      <Textarea
        autoFocus
        rows={2}
        value={draft}
        maxLength={MAX_TRIGGER_WARNING_CHARS}
        onChange={(e) => setDraft(e.target.value)}
        placeholder="e.g. graphic footage of the crash, discussion of suicide"
        className="w-full text-xs"
      />
      <p className="font-mono text-[10px] text-ink/50">
        Shown to viewers — on the overlay and appended to the chat post.
        {' '}
        {MAX_TRIGGER_WARNING_CHARS - draft.length} left.
      </p>
      <div className="flex gap-2 flex-wrap">
        <Button
          type="button"
          variant="destructive"
          size="xs"
          disabled={saving || !trimmed || !dirty}
          onClick={() => commit(trimmed)}
        >
          {saving ? 'Saving…' : 'Save warning'}
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
            Remove
          </Button>
        )}
      </div>
    </div>
  );
}

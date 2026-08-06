'use client';

import { cn } from '@/lib/utils';

export function eventsubBadge(status: string) {
  const map: Record<string, { label: string; cls: string }> = {
    enabled: { label: 'listening', cls: 'text-moss' },
    webhook_callback_verification_pending: { label: 'verifying', cls: 'text-ochre' },
    none: { label: 'none', cls: 'text-ink/40' },
  };
  const m = map[status] || { label: status.replace(/_/g, ' '), cls: 'text-rust' };
  return <span className={`font-mono text-[11px] uppercase tracking-widest whitespace-nowrap ${m.cls}`}>{m.label}</span>;
}

/**
 * A per-channel flag that's both its own status display and the control that
 * flips it — one cell, not a read-only badge in one column plus a same-named
 * button in Actions. That pairing is what was crowding the admin table's
 * Actions column before every flag got collapsed into this. Shared between
 * the channel list and the channel detail page so both read the same on/off
 * state the same way.
 */
export function ToggleBadge({
  on,
  onLabel,
  offLabel,
  onClick,
  busy,
  title,
}: {
  on: boolean;
  onLabel: string;
  offLabel: string;
  onClick: () => void;
  busy: boolean;
  title?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy}
      title={title}
      className={cn(
        'font-mono text-[11px] uppercase tracking-widest whitespace-nowrap px-2 py-1 border transition-colors disabled:opacity-40',
        on
          ? 'border-moss/50 text-moss hover:bg-moss hover:text-paper hover:border-moss'
          : 'border-ink/25 text-ink/40 hover:border-ink hover:text-ink',
      )}
    >
      {busy ? '…' : on ? onLabel : offLabel}
    </button>
  );
}

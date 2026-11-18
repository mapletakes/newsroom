import { STATUS_LABELS } from '@/lib/suspicious-log-query';

const DOT_COLOR: Record<string, string> = {
  restricted: 'bg-rust',
  active_monitoring: 'bg-ochre',
};

/** A user's status as a small colored dot, so a log line spends six pixels on
 *  it instead of a badge. The label is on hover and for screen readers. */
export function StatusDot({ status, className = '' }: { status: string; className?: string }) {
  const label = STATUS_LABELS[status] ?? status;
  return (
    <span
      role="img"
      aria-label={label}
      title={label}
      className={`inline-block h-1.5 w-1.5 shrink-0 rounded-full ${DOT_COLOR[status] ?? 'bg-ink/30'} ${className}`}
    />
  );
}

import Link from 'next/link';
import { notFound } from 'next/navigation';
import { StatusDot } from '@/app/suspicious-log/StatusDot';
import { Wordmark } from '@/components/ui/wordmark';
import { supabaseAdmin } from '@/lib/supabase';
import { formatUtc } from '@/lib/suspicious-log-query';
import { SHARED_LOG_LIMIT, loadSharedLog } from '@/lib/suspicious-log-share';

export const dynamic = 'force-dynamic';

// Nothing about what's inside goes in the title: link previews and browser
// history would otherwise carry a chatter's name somewhere the link doesn't.
// The no-referrer, noindex and no-store headers for this route are set in
// next.config.mjs.
export const metadata = {
  title: 'Shared log — The Broadside',
  robots: { index: false, follow: false },
  referrer: 'no-referrer' as const,
};

export default async function SharedLogPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const log = await loadSharedLog(supabaseAdmin(), token);
  if (!log) notFound();

  const count = log.messages.length;
  return (
    <main className="mx-auto min-h-screen max-w-4xl px-4 py-8 sm:px-6">
      <header className="mb-6 flex flex-wrap items-center gap-3">
        <Wordmark />
        <span className="font-mono text-xs uppercase tracking-widest text-ink/60">/ shared log</span>
        <Link href="/" className="ml-auto font-mono text-xs uppercase tracking-widest underline hover:text-rust">
          The Broadside →
        </Link>
      </header>

      <p className="mb-1 font-mono text-xs uppercase tracking-widest text-ink/50">
        From <strong className="text-ink">{log.channelName}</strong>&apos;s chat
      </p>
      <h1 className="mb-2 font-display text-3xl font-bold">{log.label}</h1>
      <p className="mb-4 font-mono text-xs text-ink/60">
        {count} message{count === 1 ? '' : 's'} · times are UTC · read-only · this link expires{' '}
        {formatUtc(log.expiresAt)} UTC
      </p>
      <p className="mb-4 text-xs text-ink/60">
        Messages Twitch reported from a user flagged as suspicious in this channel, shown as they were
        sent. They haven&apos;t been verified.
      </p>
      {log.truncated && (
        <p role="status" className="mb-4 border-2 border-ochre px-3 py-1.5 text-xs">
          This link covers more than {SHARED_LOG_LIMIT.toLocaleString()} messages. Only the first{' '}
          {SHARED_LOG_LIMIT.toLocaleString()} are shown.
        </p>
      )}

      <div className="rule-double mb-3" />

      {count === 0 ? (
        <p className="py-8 text-center font-mono text-sm text-ink/60">
          Every message in this link has since been deleted.
        </p>
      ) : (
        <ul className="font-mono text-[13px] leading-5">
          {log.messages.map((message, i) => (
            <li key={i} className="flex items-start gap-2 px-1 hover:bg-ink/5">
              <time dateTime={message.sent_at} className="shrink-0 tabular-nums text-ink/50">
                {formatUtc(message.sent_at)}
              </time>
              <StatusDot status={message.low_trust_status} className="mt-[7px]" />
              <span className="max-w-[10rem] shrink-0 truncate font-bold after:content-[':']">
                {message.chatter_name}
              </span>
              <span className="min-w-0 flex-1 whitespace-pre-wrap break-words">{message.message_text}</span>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}

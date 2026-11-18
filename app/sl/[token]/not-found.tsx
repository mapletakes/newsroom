import Link from 'next/link';
import { Wordmark } from '@/components/ui/wordmark';

// One answer for a link that was never valid, has expired, or was revoked: a
// stranger trying tokens learns nothing about which it was.
export default function SharedLogNotFound() {
  return (
    <main className="mx-auto min-h-screen max-w-md px-6 py-16 text-center">
      <div className="mb-8 flex justify-center">
        <Wordmark />
      </div>
      <h1 className="mb-2 font-display text-3xl font-bold">This link isn&apos;t available</h1>
      <div className="rule-double mb-6" />
      <p className="mb-6 leading-relaxed text-ink/70">
        It may have expired or been revoked. Ask whoever sent it to make a new one.
      </p>
      <Link href="/" className="font-mono text-xs uppercase tracking-widest underline hover:text-rust">
        The Broadside →
      </Link>
    </main>
  );
}

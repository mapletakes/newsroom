import Link from 'next/link';
import { buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export default function Login({ searchParams }: { searchParams: { error?: string; detail?: string } }) {
  const errorMap: Record<string, string> = {
    state: 'OAuth state mismatch — please try again.',
    oauth: 'Twitch sign-in failed.',
  };
  const errMsg = searchParams.error && (errorMap[searchParams.error] || searchParams.error);
  const detail = searchParams.detail;

  return (
    <main className="min-h-screen flex items-center justify-center px-6">
      <div className="max-w-md w-full">
        <h1 className="font-display text-4xl font-bold mb-2">Sign in</h1>
        <div className="rule-double mb-6" />
        <p className="mb-8 leading-relaxed">
          The Broadside connects to your Twitch chat to capture links. We request
          read-only access — we can&apos;t post, ban, or change anything.
        </p>
        {errMsg && (
          <div className="border-2 border-rust text-rust px-4 py-3 mb-6 font-mono text-sm">
            {errMsg}
            {detail && <div className="mt-1 text-xs opacity-75">{detail}</div>}
          </div>
        )}
        <a href="/api/twitch/oauth" className={cn(buttonVariants({ size: 'lg' }), 'w-full')}>
          Continue with Twitch
        </a>
        <p className="mt-4 font-mono text-xs text-ink/50 leading-relaxed">
          By continuing, you agree to the{' '}
          <Link href="/terms" className="underline hover:text-rust">Terms of Service</Link> and{' '}
          <Link href="/privacy" className="underline hover:text-rust">Privacy Policy</Link>.
        </p>
      </div>
    </main>
  );
}

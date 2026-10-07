import Link from 'next/link';
import { buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { EmailSignIn } from './EmailSignIn';

export default async function Login({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; detail?: string }>;
}) {
  const sp = await searchParams;
  const errorMap: Record<string, string> = {
    state: 'OAuth state mismatch — please try again.',
    oauth: 'Sign-in failed.',
    link: 'That sign-in link has expired or was already used. Request a new one.',
  };
  const errMsg = sp.error && (errorMap[sp.error] || sp.error);
  const detail = sp.detail;

  return (
    <main className="min-h-screen flex items-center justify-center px-6">
      <div className="max-w-md w-full">
        <h1 className="font-display text-4xl font-bold mb-2">Sign in</h1>
        <div className="rule-double mb-6" />
        <p className="mb-8 leading-relaxed">
          Connect Twitch to capture links from your chat and post &ldquo;Watching:&rdquo; updates
          to it, or skip Twitch and use just the deck and shelves with an email address.
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
        <div className="flex items-center gap-3 my-6 font-mono text-xs uppercase tracking-widest text-ink/40">
          <div className="flex-1 border-t border-ink/20" /> or <div className="flex-1 border-t border-ink/20" />
        </div>
        <EmailSignIn />
        <p className="mt-4 font-mono text-xs text-ink/50 leading-relaxed">
          By continuing, you agree to the{' '}
          <Link href="/terms" className="underline hover:text-rust">Terms of Service</Link> and{' '}
          <Link href="/privacy" className="underline hover:text-rust">Privacy Policy</Link>.
        </p>
      </div>
    </main>
  );
}

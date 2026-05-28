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
          Newsroom connects to your Twitch chat to capture links. We request
          read-only access — we can&apos;t post, ban, or change anything.
        </p>
        {errMsg && (
          <div className="border-2 border-rust text-rust px-4 py-3 mb-6 font-mono text-sm">
            {errMsg}
            {detail && <div className="mt-1 text-xs opacity-75">{detail}</div>}
          </div>
        )}
        <a
          href="/api/twitch/oauth"
          className="block text-center bg-ink text-paper px-6 py-4 font-mono text-sm uppercase tracking-widest hover:bg-rust transition-colors"
        >
          Continue with Twitch
        </a>
      </div>
    </main>
  );
}

'use client';

export default function BlockedPage() {
  const logout = async () => {
    await fetch('/api/auth', { method: 'POST' });
    window.location.href = '/';
  };

  return (
    <main className="min-h-screen flex items-center justify-center px-6">
      <div className="max-w-md w-full text-center">
        <h1 className="font-display text-4xl font-bold mb-2">Access pending</h1>
        <div className="rule-double mb-6" />
        <p className="leading-relaxed mb-6">
          Your channel isn&apos;t approved for The Broadside yet, or access has been
          paused. If you think this is a mistake, reach out to an admin.
        </p>
        <button
          onClick={logout}
          className="inline-block font-mono text-sm uppercase tracking-widest border border-ink/40 px-4 py-2 hover:bg-ink hover:text-paper"
        >
          Sign out
        </button>
      </div>
    </main>
  );
}

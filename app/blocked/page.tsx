'use client';

import { Button } from '@/components/ui/button';

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
        <Button variant="outline" onClick={logout}>
          Sign out
        </Button>
      </div>
    </main>
  );
}

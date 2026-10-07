'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

// Magic-link sign-in for people who don't want to (or can't) connect Twitch.
export function EmailSignIn() {
  const [email, setEmail] = useState('');
  const [state, setState] = useState<'idle' | 'sending' | 'sent'>('idle');
  const [error, setError] = useState('');

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setState('sending');
    setError('');
    const r = await fetch('/api/auth/email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email }),
    }).catch(() => null);
    if (r?.ok) {
      setState('sent');
      return;
    }
    const data = (await r?.json().catch(() => ({}))) ?? {};
    setError(data.error || 'Could not send the link. Try again.');
    setState('idle');
  };

  if (state === 'sent') {
    return (
      <div className="border-2 border-ink px-4 py-3 font-mono text-sm leading-relaxed">
        Check <strong>{email}</strong> for a sign-in link. It works once and expires soon — if it
        doesn&apos;t arrive in a minute, check spam.
        <button
          type="button"
          onClick={() => setState('idle')}
          className="block mt-2 underline hover:text-rust text-xs"
        >
          Use a different address
        </button>
      </div>
    );
  }

  return (
    <form onSubmit={submit}>
      <label className="block mb-2">
        <span className="font-mono text-xs uppercase tracking-widest text-ink/60">
          Or sign in with email
        </span>
        <Input
          type="email"
          required
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@example.com"
          className="w-full mt-1 p-3"
        />
      </label>
      {error && <div className="font-mono text-xs text-rust mb-2">{error}</div>}
      <Button type="submit" variant="outline" size="lg" className="w-full" disabled={state === 'sending'}>
        {state === 'sending' ? 'Sending…' : 'Email me a sign-in link'}
      </Button>
      <p className="mt-2 font-mono text-[11px] text-ink/50 leading-relaxed">
        Email accounts get the deck and shelves. Chat features (capturing links from chat, posting
        to chat, questions, raffles) need a Twitch channel.
      </p>
    </form>
  );
}

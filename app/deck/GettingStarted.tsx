'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useEventSubStatus } from '@/lib/use-eventsub-status';

const DISMISSED_KEY = 'broadside_onboarding_dismissed';

// A dismiss-once "getting started" panel for the streamer deck. Not tied to
// account age or activity — simpler and more honest to just let the user
// dismiss it than to guess "is this a new account" from imperfect signals.
export function GettingStarted() {
  const { status } = useEventSubStatus();
  const [dismissed, setDismissed] = useState(true); // default hidden until we check storage (avoids flash)

  useEffect(() => {
    setDismissed(localStorage.getItem(DISMISSED_KEY) === '1');
  }, []);

  const dismiss = () => {
    localStorage.setItem(DISMISSED_KEY, '1');
    setDismissed(true);
  };

  if (dismissed) return null;

  return (
    <div className="mb-4 card-paper p-4 relative">
      <button
        onClick={dismiss}
        className="absolute top-2 right-2 text-ink/30 hover:text-rust"
        aria-label="Dismiss"
      >
        <span className="material-icons text-base">close</span>
      </button>
      <h3 className="font-display text-lg font-bold mb-3">Getting started</h3>
      <ul className="space-y-2 text-sm">
        <li className="flex items-center gap-2">
          <span className={status === 'connected' ? 'text-moss' : 'text-ink/30'}>
            <span className="material-icons text-base align-middle">
              {status === 'connected' ? 'check_circle' : 'radio_button_unchecked'}
            </span>
          </span>
          Chat connected — links your chat posts get captured automatically.
          {status !== 'connected' && status !== 'loading' && (
            <Link href="/setup" className="underline hover:text-rust ml-1">Fix in Settings →</Link>
          )}
        </li>
        <li className="flex items-start gap-2">
          <span className="text-ink/30">
            <span className="material-icons text-base align-middle">radio_button_unchecked</span>
          </span>
          <span>
            Tell your mods to sign in at this site once — they&apos;ll show up under{' '}
            <Link href="/setup" className="underline hover:text-rust">Settings → Curators</Link>{' '}
            for you to grant deck access.
          </span>
        </li>
        <li className="flex items-start gap-2">
          <span className="text-ink/30">
            <span className="material-icons text-base align-middle">radio_button_unchecked</span>
          </span>
          <span>
            Grab the <Link href="/setup" className="underline hover:text-rust">quick-add bookmarklet or Chrome extension</Link>{' '}
            to add links while you&apos;re prepping, without switching tabs.
          </span>
        </li>
        <li className="flex items-start gap-2">
          <span className="text-ink/30">
            <span className="material-icons text-base align-middle">radio_button_unchecked</span>
          </span>
          <span>Use <strong>+ Segment</strong> below to organize the deck into named blocks for your show.</span>
        </li>
      </ul>
    </div>
  );
}

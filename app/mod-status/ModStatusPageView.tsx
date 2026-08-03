'use client';

import Link from 'next/link';
import { AppHeader } from '@/components/AppHeader';
import { ModStatusPanel } from '@/components/ModStatusPanel';
import { Icon } from '@/components/ui/icon';

/**
 * The whole point: a bookmarkable, no-frills equivalent of the drawer for
 * checking in from a phone that isn't already sitting on the deck or mod
 * view. Nothing here but the header and the board.
 */
export function ModStatusPageView({
  streamId,
  displayName,
  channel,
  isMod,
}: {
  streamId: string;
  displayName: string;
  channel: string;
  isMod: boolean;
}) {
  return (
    <div className="min-h-screen flex flex-col">
      <AppHeader
        className="border-b-2 border-ink px-6 py-3 gap-6"
        section={<>mod status{isMod && <> · {displayName}</>}</>}
        right={
          <>
            <span className="uppercase tracking-widest">#{channel}</span>
            {isMod && <Link href="/mod" className="underline hover:text-rust">Mod View →</Link>}
            {!isMod && <Link href="/deck" className="underline hover:text-rust">Streamer Deck →</Link>}
          </>
        }
      />
      <main className="flex-1 flex flex-col px-3 sm:px-6 py-6 max-w-md mx-auto w-full">
        <div className="flex items-center gap-2 mb-3 text-ink/60">
          <Icon name="mobile" className="text-sm" />
          <p className="font-mono text-[11px] leading-relaxed">
            Set your availability and go — bookmark this page for a one-tap check-in.
          </p>
        </div>
        <ModStatusPanel streamId={streamId} enabled variant="page" />
      </main>
    </div>
  );
}

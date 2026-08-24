'use client';

import Link from 'next/link';
import { AppHeader } from '@/components/AppHeader';
import { ModStatusPanel } from '@/components/ModStatusPanel';
import { Icon } from '@/components/ui/icon';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

type ChannelOption = { id: string; login: string; name: string };

/**
 * #channel as a switcher rather than a label — mods keep this page open all
 * night, often across several channels they cover, and the only way to check
 * a different one used to be a round trip through /choose. Only rendered as
 * a dropdown when there's actually something to switch to; with zero or one
 * channel it's the same plain text as before, same reasoning as
 * SendToDeckMenu falling back to a plain button with nothing to pick between.
 */
function ChannelSwitcher({ current, channels }: { current: string; channels: ChannelOption[] }) {
  const others = channels.filter((c) => c.login !== current);
  if (others.length === 0) {
    return <span className="uppercase tracking-widest">#{current}</span>;
  }

  const switchTo = async (streamId: string) => {
    await fetch('/api/auth/switch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ streamId, role: 'mod' }),
    });
    window.location.href = '/mod-status';
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="uppercase tracking-widest underline hover:text-rust inline-flex items-center gap-1">
        #{current} <Icon name="expand" className="text-xs" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuLabel>Switch channel</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem disabled>#{current} (current)</DropdownMenuItem>
        {others.map((c) => (
          <DropdownMenuItem key={c.id} onSelect={() => switchTo(c.id)}>
            #{c.login}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

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
  channels,
}: {
  streamId: string;
  displayName: string;
  channel: string;
  isMod: boolean;
  /** Every channel this account moderates — see ChannelSwitcher. */
  channels: ChannelOption[];
}) {
  return (
    <div className="min-h-screen flex flex-col">
      <AppHeader
        className="border-b-2 border-ink px-6 py-3 gap-6"
        section={<>mod status{isMod && <> · {displayName}</>}</>}
        right={
          <>
            <ChannelSwitcher current={channel} channels={channels} />
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

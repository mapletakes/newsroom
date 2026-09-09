'use client';

// Approve/Reject buttons + optional note field, rendered on a pending
// submission's card. Fully self-contained. Split out of ModView.tsx as a
// structural move only, no rendered output changed.

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

export type ModActionsSegment = { id: string; name: string };

export function ModActions({
  id,
  onApprove,
  onReject,
  pending,
  segments,
}: {
  id: string;
  onApprove: (id: string, note: string, segmentId?: string | null) => void;
  onReject: (id: string) => void;
  pending: boolean;
  // Streamer, or a mod authorized to curate — see sessionCanCurate. Omitted
  // (or empty) for anyone else, in which case only the plain "into ungrouped"
  // Approve button renders; the split-button segment picker is purely a UI
  // convenience for a role that could already reach the same result via
  // deck drag-and-drop after approving.
  segments?: ModActionsSegment[];
}) {
  const [note, setNote] = useState('');
  const [showNote, setShowNote] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  const hasSegments = !!segments && segments.length > 0;

  return (
    <div className="flex flex-col gap-2 w-full">
      <div className="flex gap-2 items-center">
        <div className="flex flex-1 sm:flex-none">
          <Button
            variant="moss"
            size="sm"
            className={`px-4 py-2.5 text-sm sm:px-3 sm:py-1.5 sm:text-xs flex-1 sm:flex-none ${hasSegments ? 'rounded-r-none border-r border-r-ink/20' : ''}`}
            onClick={() => onApprove(id, note)}
            disabled={pending}
          >
            {pending ? 'Working…' : 'Approve'}
          </Button>
          {hasSegments && (
            <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="moss"
                  size="sm"
                  className="px-2 py-2.5 sm:py-1.5 rounded-l-none"
                  disabled={pending}
                  aria-label="Approve into a segment"
                >
                  ▾
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start">
                <DropdownMenuLabel>Approve into…</DropdownMenuLabel>
                <DropdownMenuItem onSelect={() => onApprove(id, note, null)}>
                  Ungrouped
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                {segments.map((seg) => (
                  <DropdownMenuItem key={seg.id} onSelect={() => onApprove(id, note, seg.id)}>
                    {seg.name}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
        <Button
          variant="outline"
          size="sm"
          className="flex-1 sm:flex-none px-4 py-2.5 text-sm sm:px-3 sm:py-1.5 sm:text-xs"
          onClick={() => onReject(id)}
          disabled={pending}
        >
          Reject
        </Button>
      </div>
      <button
        onClick={() => setShowNote(!showNote)}
        className="self-start font-mono text-xs uppercase tracking-widest text-ink/50 hover:text-ink"
      >
        {showNote ? '− hide note' : '+ add note'}
      </button>
      {showNote && (
        <Input
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="e.g. skip to 4:32, check the replies, paywalled..."
          className="w-full text-xs"
        />
      )}
    </div>
  );
}

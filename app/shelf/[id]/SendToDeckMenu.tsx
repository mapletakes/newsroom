'use client';

// A "Send to deck" button that becomes a dropdown (ungrouped + each deck
// segment) once the stream has any segments defined — otherwise it's a
// single click straight to ungrouped. Shared by the per-item row and the
// shelf-level "Send all" action. Distinct from rundown-mode sending, which
// targets the shelf's OWN block structure rather than one chosen deck
// segment. Pure/presentational — split out of ShelfDetailView.tsx as a
// structural move only, no rendered output changed.

import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

export type DeckSegment = { id: string; name: string };

export function SendToDeckMenu({
  segments,
  onSend,
  label = 'Send to deck',
  size = 'sm',
}: {
  segments: DeckSegment[];
  onSend: (segmentId: string | null, label: string) => void;
  label?: string;
  size?: 'xs' | 'sm';
}) {
  if (segments.length === 0) {
    return (
      <Button variant="outline" size={size} onClick={() => onSend(null, '')}>
        {label}
      </Button>
    );
  }
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size={size}>
          {label} <Icon name="expand" className="text-xs ml-0.5" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        <DropdownMenuLabel>Send to</DropdownMenuLabel>
        <DropdownMenuItem onSelect={() => onSend(null, 'Ungrouped')}>Ungrouped</DropdownMenuItem>
        <DropdownMenuSeparator />
        {segments.map((s) => (
          <DropdownMenuItem key={s.id} onSelect={() => onSend(s.id, s.name)}>
            {s.name}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

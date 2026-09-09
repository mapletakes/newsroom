'use client';

import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Key, Row } from '@/app/deck/ShortcutsModal';

export function ModShortcutsModal({
  open,
  onOpenChange,
  segments = [],
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  // Streamer, or a mod authorized to curate — same audience as the segment
  // picker on each card (see ModActions). Empty for anyone else, in which
  // case the number-key row is left out entirely.
  segments?: { id: string; name: string }[];
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Keyboard shortcuts</DialogTitle>
          <DialogDescription>Work the pending queue without touching the mouse.</DialogDescription>
        </DialogHeader>
        <div>
          <Row keys={<><Key>J</Key><Key>K</Key></>}>Move the highlight down or up</Row>
          <Row keys={<><Key>↑</Key><Key>↓</Key></>}>Same, if you&apos;d rather use arrows</Row>
          <Row keys={<Key>A</Key>}>Approve the highlighted item</Row>
          <Row keys={<Key>R</Key>}>Reject the highlighted item</Row>
          {segments.length > 0 && (
            <Row keys={<Key>1</Key>}>
              Approve into the 1st segment{segments.length > 1 ? ` (2–${Math.min(9, segments.length)} for the rest, in deck order)` : ''}
            </Row>
          )}
          <Row keys={<Key>Enter</Key>}>Open the highlighted item&apos;s source link</Row>
          <Row keys={<Key>?</Key>}>Show this help</Row>
        </div>
      </DialogContent>
    </Dialog>
  );
}

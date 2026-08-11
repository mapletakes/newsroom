'use client';

import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Key, Row } from '@/app/deck/ShortcutsModal';

export function ModShortcutsModal({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
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
          <Row keys={<Key>Enter</Key>}>Open the highlighted item&apos;s source link</Row>
          <Row keys={<Key>?</Key>}>Show this help</Row>
        </div>
      </DialogContent>
    </Dialog>
  );
}

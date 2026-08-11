'use client';

import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';

export function Key({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="inline-flex items-center justify-center min-w-[1.75rem] px-1.5 py-0.5 border border-ink/30 bg-ink/5 rounded-sm font-mono text-[11px] leading-none">
      {children}
    </kbd>
  );
}

export function Row({ keys, children }: { keys: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3 py-1.5 border-b border-ink/10 last:border-0">
      <div className="shrink-0 w-32 flex items-center gap-1 flex-wrap">{keys}</div>
      <div className="text-sm text-ink/80">{children}</div>
    </div>
  );
}

export function ShortcutsModal({
  open,
  onOpenChange,
  curateOnly,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  curateOnly: boolean;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Keyboard shortcuts</DialogTitle>
          <DialogDescription>Work the queue without touching the mouse.</DialogDescription>
        </DialogHeader>
        <div>
          <Row keys={<><Key>↑</Key><Key>↓</Key></>}>Move the selection up or down in play order</Row>
          <Row keys={<><Key>⌃</Key>/<Key>⌘</Key>+<Key>↑</Key><Key>↓</Key></>}>
            Nudge the active item within its segment
          </Row>
          <Row keys={<Key>Enter</Key>}>Open the active item&apos;s source link</Row>
          {!curateOnly && <Row keys={<Key>P</Key>}>Mark the active item played and advance</Row>}
          <Row keys={<><Key>Del</Key><Key>⌫</Key></>}>Remove the active item from the deck</Row>
          <Row keys={<Key>Esc</Key>}>Clear a multi-selection</Row>
          <Row keys={<Key>Click</Key>}>Select a card (clears multi-select)</Row>
          <Row keys={<><Key>⇧</Key>Click</>}>Extend the selection to a range</Row>
          <Row keys={<><Key>⌃</Key>/<Key>⌘</Key>Click</>}>Toggle a card in the selection</Row>
          <Row keys={<Key>Drag</Key>}>Reorder items or move them between segments</Row>
          <Row keys={<Key>?</Key>}>Show this help</Row>
        </div>
      </DialogContent>
    </Dialog>
  );
}

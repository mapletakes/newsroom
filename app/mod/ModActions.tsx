'use client';

// Approve/Reject buttons + optional note field, rendered on a pending
// submission's card. Fully self-contained. Split out of ModView.tsx as a
// structural move only, no rendered output changed.

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

export function ModActions({
  id,
  onApprove,
  onReject,
  pending,
}: {
  id: string;
  onApprove: (id: string, note: string) => void;
  onReject: (id: string) => void;
  pending: boolean;
}) {
  const [note, setNote] = useState('');
  const [showNote, setShowNote] = useState(false);

  return (
    <div className="flex flex-col gap-2 w-full">
      <div className="flex gap-2 items-center">
        <Button
          variant="moss"
          size="sm"
          className="flex-1 sm:flex-none px-4 py-2.5 text-sm sm:px-3 sm:py-1.5 sm:text-xs"
          onClick={() => onApprove(id, note)}
          disabled={pending}
        >
          {pending ? 'Working…' : 'Approve'}
        </Button>
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

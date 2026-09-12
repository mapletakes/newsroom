'use client';

// Small clipboard-copy button, used next to the "on air" item's URL. Fully
// self-contained. Split out of ModView.tsx as a structural move only, no
// rendered output changed.

import { useState } from 'react';
import { Button } from '@/components/ui/button';

export function CopyButton({ value, label = 'Copy', className = '' }: { value: string; label?: string; className?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      variant="outline"
      size="xs"
      className={`shrink-0 text-xs ${className}`}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        } catch {
          /* clipboard unavailable */
        }
      }}
    >
      {copied ? 'Copied!' : label}
    </Button>
  );
}

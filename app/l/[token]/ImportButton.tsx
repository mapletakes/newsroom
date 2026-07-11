'use client';

import { useState } from 'react';
import { Button, buttonVariants } from '@/components/ui/button';
import { toast } from 'sonner';

export function ImportButton({ token, loggedIn }: { token: string; loggedIn: boolean }) {
  const [importing, setImporting] = useState(false);

  if (!loggedIn) {
    return (
      <a href="/api/twitch/oauth" className={buttonVariants()}>
        Connect Twitch to import →
      </a>
    );
  }

  const doImport = async () => {
    if (importing) return;
    setImporting(true);
    try {
      const r = await fetch('/api/lists/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token }),
      });
      if (r.ok) {
        const data = await r.json();
        toast.success('Imported — opening your copy…');
        window.location.href = `/lists/${data.list.id}`;
      } else {
        const e = await r.json().catch(() => ({}));
        toast.error(e.error || 'Failed to import');
        setImporting(false);
      }
    } catch {
      toast.error('Failed to import');
      setImporting(false);
    }
  };

  return (
    <Button onClick={doImport} disabled={importing}>
      {importing ? 'Importing…' : 'Import to my clip files'}
    </Button>
  );
}

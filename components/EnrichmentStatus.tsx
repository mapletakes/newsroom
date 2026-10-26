'use client';

import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Button } from './ui/button';

export type EnrichmentState = 'idle' | 'queued' | 'running' | 'complete' | 'skipped' | 'failed';

export function EnrichmentStatus({ id, state, retryable = true }: { id: string; state?: EnrichmentState; retryable?: boolean }) {
  const queryClient = useQueryClient();
  const [retrying, setRetrying] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  if (!state || state === 'idle' || state === 'complete' || state === 'skipped') return null;

  async function retry() {
    setRetrying(true);
    setMessage(null);
    try {
      const response = await fetch('/api/queue/enrichment', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id }),
      });
      if (!response.ok) {
        setMessage(response.status === 409
          ? 'Already processing or no longer available for retry.'
          : 'Could not start a retry. Try again.');
      } else {
        setMessage('Retry started.');
      }
      await queryClient.invalidateQueries({ queryKey: ['queue'] });
    } catch {
      setMessage('Could not start a retry. Check your connection.');
    } finally {
      setRetrying(false);
    }
  }

  return (
    <div className="my-2 flex flex-wrap items-center gap-2 font-mono text-xs text-ink/60" role="status">
      <span>{state === 'queued' ? 'Enrichment queued' : state === 'running' ? 'Enriching…' : 'Enrichment failed'}</span>
      {state === 'failed' && retryable && (
        <Button size="sm" variant="outline" disabled={retrying} onClick={retry}>
          {retrying ? 'Retrying…' : 'Retry enrichment'}
        </Button>
      )}
      {message && <span>{message}</span>}
    </div>
  );
}

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { EnrichmentStatus, type EnrichmentState } from './EnrichmentStatus';

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

function show(state: EnrichmentState, retryable = true) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const invalidate = vi.spyOn(client, 'invalidateQueries');
  render(<QueryClientProvider client={client}><EnrichmentStatus id="submission-1" state={state} retryable={retryable} /></QueryClientProvider>);
  return invalidate;
}

describe('EnrichmentStatus', () => {
  it.each(['idle', 'complete', 'skipped'] as const)('does not add status controls for %s items', (state) => {
    show(state);
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it.each([['queued', 'Enrichment queued'], ['running', 'Enriching…']] as const)('shows %s work without a retry button', (state, label) => {
    show(state);
    expect(screen.getByRole('status')).toHaveTextContent(label);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('starts a retry and refreshes queue state without approving again', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('{}', { status: 202 }));
    vi.stubGlobal('fetch', fetchMock);
    const invalidate = show('failed');
    await userEvent.click(screen.getByRole('button', { name: 'Retry enrichment' }));
    expect(fetchMock).toHaveBeenCalledWith('/api/queue/enrichment', expect.objectContaining({
      method: 'POST', body: JSON.stringify({ id: 'submission-1' }),
    }));
    expect(await screen.findByText('Retry started.')).toBeInTheDocument();
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['queue'] });
  });

  it('handles a competing retry and lets the user see the latest state', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 409 })));
    show('failed');
    await userEvent.click(screen.getByRole('button', { name: 'Retry enrichment' }));
    expect(await screen.findByText('Already processing or no longer available for retry.')).toBeInTheDocument();
    expect(screen.getByRole('button')).toBeEnabled();
  });

  it('keeps retry available after a network failure', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
    show('failed');
    await userEvent.click(screen.getByRole('button', { name: 'Retry enrichment' }));
    expect(await screen.findByText('Could not start a retry. Check your connection.')).toBeInTheDocument();
    expect(screen.getByRole('button')).toBeEnabled();
  });

  it('does not offer retry for items no longer on the approved deck', () => {
    show('failed', false);
    expect(screen.getByRole('status')).toHaveTextContent('Enrichment failed');
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
});

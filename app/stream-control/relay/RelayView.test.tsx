import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { RelayCallbacks } from './relay';

const relay = vi.hoisted(() => ({
  cb: null as RelayCallbacks | null,
  start: vi.fn(),
  stop: vi.fn(),
  claim: vi.fn(async () => {}),
  heartbeat: vi.fn(async () => null),
}));

vi.mock('./relay', () => ({
  createRelay: (cb: RelayCallbacks) => {
    relay.cb = cb;
    return relay;
  },
}));
vi.mock('@/lib/use-realtime-channel', () => ({ useRealtimeChannel: vi.fn() }));
vi.mock('@/components/AppHeader', () => ({ AppHeader: () => null }));

import { RelayView } from './RelayView';

const KEY = 'broadside:stream-control:token:s1';

beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
});
afterEach(() => {
  cleanup();
  localStorage.clear();
});

describe('RelayView', () => {
  it('connects with a pasted token and remembers it', () => {
    render(<RelayView streamId="s1" />);
    expect(relay.start).not.toHaveBeenCalled();
    fireEvent.change(screen.getByPlaceholderText('Paste from Streamlabs'), { target: { value: ' tok ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Connect' }));
    expect(relay.start).toHaveBeenCalledWith('tok');
    expect(localStorage.getItem(KEY)).toBe('tok');
  });

  it('does not store the token when asked not to', () => {
    render(<RelayView streamId="s1" />);
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.change(screen.getByPlaceholderText('Paste from Streamlabs'), { target: { value: 'tok' } });
    fireEvent.click(screen.getByRole('button', { name: 'Connect' }));
    expect(relay.start).toHaveBeenCalledWith('tok');
    expect(localStorage.getItem(KEY)).toBeNull();
  });

  it('connects straight away with a remembered token', () => {
    localStorage.setItem(KEY, 'saved');
    render(<RelayView streamId="s1" />);
    expect(relay.start).toHaveBeenCalledWith('saved');
  });

  it('shows the live scene once connected, and errors in plain words', () => {
    render(<RelayView streamId="s1" />);
    act(() => {
      relay.cb!.onPhase('connected', null);
      relay.cb!.onSnapshot({ activeSceneId: 'a', scenes: [{ id: 'a', name: 'Live Scene', items: [] }] });
      relay.cb!.onLog({ at: 0, text: 'modA switched to Live Scene', tone: 'ok' });
    });
    expect(screen.getByRole('status')).toHaveTextContent('Connected to Streamlabs');
    expect(screen.getByText('Live Scene')).toBeInTheDocument();
    expect(screen.getByText('modA switched to Live Scene')).toBeInTheDocument();
    act(() => relay.cb!.onPhase('error', 'Streamlabs rejected the token.'));
    expect(screen.getByText('Streamlabs rejected the token.')).toBeInTheDocument();
  });

  it('forgets the token', () => {
    localStorage.setItem(KEY, 'saved');
    render(<RelayView streamId="s1" />);
    fireEvent.click(screen.getByRole('button', { name: 'Forget token' }));
    expect(relay.stop).toHaveBeenCalled();
    expect(localStorage.getItem(KEY)).toBeNull();
    expect(screen.getByPlaceholderText('Paste from Streamlabs')).toHaveValue('');
  });
});

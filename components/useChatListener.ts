'use client';

import { useEffect, useRef, useState } from 'react';
import { ChatListener, type ChatSubmission } from '@/lib/chat-listener';

export function useChatListener(opts: {
  channel: string | null;
  submitCommand?: string;
  allowAnyone?: boolean;
  onSubmission: (s: ChatSubmission) => void;
}) {
  const [status, setStatus] = useState<'idle' | 'connecting' | 'connected' | 'disconnected'>('idle');
  const ref = useRef<ChatListener | null>(null);
  // Stash latest callback in a ref so we don't tear down on each render
  const cbRef = useRef(opts.onSubmission);
  useEffect(() => { cbRef.current = opts.onSubmission; }, [opts.onSubmission]);

  useEffect(() => {
    if (!opts.channel) return;
    setStatus('connecting');
    const listener = new ChatListener({
      channel: opts.channel,
      submitCommand: opts.submitCommand,
      allowAnyone: opts.allowAnyone,
      onSubmission: (s) => cbRef.current(s),
      onConnect: () => setStatus('connected'),
      onDisconnect: () => setStatus('disconnected'),
    });
    ref.current = listener;
    listener.start().catch((e) => {
      console.error('chat listener failed', e);
      setStatus('disconnected');
    });
    return () => {
      listener.stop();
      ref.current = null;
    };
  }, [opts.channel, opts.submitCommand, opts.allowAnyone]);

  return { status };
}

'use client';

// Discord export widget: paste-a-webhook + preview/post. Split out of
// SetupForm.tsx the same way QuickAdd.tsx was — self-contained except for
// `configured`/`setConfigured`, which the parent owns so a save here is
// reflected immediately without a page reload.

import { useState } from 'react';
import { toast } from 'sonner';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

type Preview = { count: number; messages: string[] };

export function DiscordExport({
  configured,
  setConfigured,
}: {
  configured: boolean;
  setConfigured: (v: boolean) => void;
}) {
  const [webhookInput, setWebhookInput] = useState('');
  // Starts in edit mode when nothing's configured yet, so a first-time
  // streamer sees the input immediately instead of an empty "configured"
  // toggle with no way to fill it.
  const [editing, setEditing] = useState(!configured);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [posting, setPosting] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [preview, setPreview] = useState<Preview | null>(null);
  const { confirm, confirmDialog } = useConfirm();

  const saveWebhook = async () => {
    if (!webhookInput.trim()) return;
    setSaving(true);
    setSaveError('');
    const r = await fetch('/api/setup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ discord_webhook_url: webhookInput.trim() }),
    });
    setSaving(false);
    if (r.ok) {
      setConfigured(true);
      setEditing(false);
      setWebhookInput('');
      setPreview(null);
      toast.success('Discord webhook saved');
    } else {
      const data = await r.json().catch(() => ({}));
      setSaveError(data.detail || data.error || 'Could not save.');
    }
  };

  const removeWebhook = async () => {
    if (!(await confirm({
      title: 'Remove Discord webhook?',
      description: 'Played-list posts stop until you add a new one. A later webhook starts fresh rather than posting everything missed.',
      confirmText: 'Remove',
      destructive: true,
    }))) return;
    const r = await fetch('/api/setup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ remove_discord_webhook: true }),
    });
    if (r.ok) {
      setConfigured(false);
      setEditing(true);
      setPreview(null);
      toast('Discord webhook removed');
    } else {
      toast.error('Could not remove webhook');
    }
  };

  const loadPreview = async () => {
    setPreviewing(true);
    try {
      const r = await fetch('/api/notes/discord');
      const data = await r.json().catch(() => ({}));
      if (r.ok) setPreview(data);
      else toast.error(data.error || 'Could not load preview');
    } finally {
      setPreviewing(false);
    }
  };

  const postNow = async () => {
    if (!(await confirm({
      title: 'Post played list to Discord?',
      description: 'Sends everything played since the last Discord post to your configured channel.',
      confirmText: 'Post',
    }))) return;
    setPosting(true);
    const id = toast.loading('Posting to Discord…');
    try {
      const r = await fetch('/api/notes/discord', { method: 'POST' });
      const data = await r.json().catch(() => ({}));
      if (r.ok) {
        toast.success(`Posted ${data.count} item${data.count === 1 ? '' : 's'} to Discord`, { id });
        setPreview(null);
      } else if (data.error === 'nothing-to-post') {
        toast('Nothing new to post', { id });
      } else {
        toast.error(data.detail || data.error || 'Could not post to Discord', { id });
      }
    } catch {
      toast.error('Could not post to Discord', { id });
    } finally {
      setPosting(false);
    }
  };

  return (
    <div>
      {confirmDialog}
      <p className="text-sm text-ink/70 leading-relaxed mb-4 max-w-prose">
        Posts the played list to a Discord channel as one or more messages, numbered with
        elapsed time since the first item played. Create a webhook in that channel&apos;s{' '}
        <span className="text-ink/50">Edit Channel &rarr; Integrations &rarr; Webhooks</span>,
        then paste its URL below.
      </p>

      {configured && !editing ? (
        <div className="flex flex-wrap items-center gap-3 font-mono text-sm mb-2">
          <span>Webhook configured &#10003;</span>
          <Button type="button" variant="outline" size="sm" onClick={() => setEditing(true)}>
            Replace
          </Button>
          <Button type="button" variant="outline" size="sm" onClick={removeWebhook}>
            Remove
          </Button>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-2 mb-2">
          <Input
            type="password"
            placeholder="https://discord.com/api/webhooks/…"
            value={webhookInput}
            onChange={(e) => setWebhookInput(e.target.value)}
            className="flex-1 min-w-0 max-w-md"
            aria-label="Discord webhook URL"
          />
          <Button type="button" size="sm" onClick={saveWebhook} disabled={saving || !webhookInput.trim()}>
            {saving ? 'Saving…' : 'Save webhook'}
          </Button>
          {configured && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                setEditing(false);
                setWebhookInput('');
                setSaveError('');
              }}
            >
              Cancel
            </Button>
          )}
        </div>
      )}
      {saveError && <p className="font-mono text-xs text-rust mb-2">{saveError}</p>}

      {configured && (
        <div className="mt-4 space-y-3">
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" size="sm" onClick={loadPreview} disabled={previewing}>
              {previewing ? 'Loading…' : 'Preview next post'}
            </Button>
            <Button type="button" size="sm" onClick={postNow} disabled={posting}>
              {posting ? 'Posting…' : 'Post played list now'}
            </Button>
          </div>
          {preview &&
            (preview.count === 0 ? (
              <p className="font-mono text-xs text-ink/50">Nothing new to post.</p>
            ) : (
              <div className="space-y-2">
                <p className="font-mono text-xs text-ink/50">
                  {preview.count} item{preview.count === 1 ? '' : 's'} &middot; {preview.messages.length} message
                  {preview.messages.length === 1 ? '' : 's'}
                </p>
                {preview.messages.map((m, i) => (
                  <pre
                    key={i}
                    className="whitespace-pre-wrap font-mono text-xs bg-ink/5 border border-ink/20 p-3 max-w-2xl overflow-x-auto"
                  >
                    {m}
                  </pre>
                ))}
              </div>
            ))}
        </div>
      )}
    </div>
  );
}

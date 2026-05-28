'use client';

import tmi from 'tmi.js';
import { extractUrlsFromMessage, normalizeUrl, detectKind } from './url';

export type ChatSubmission = {
  url: string;
  normalizedUrl: string;
  kind: ReturnType<typeof detectKind>;
  submitter: string;
  isSub: boolean;
  isMod: boolean;
  isVip: boolean;
  message: string;
  timestamp: number;
};

export type ChatListenerOptions = {
  channel: string;
  submitCommand?: string; // e.g. '!submit' — if set, only commands trigger
  allowAnyone?: boolean;  // if false, only sub/vip/mod links count
  onSubmission: (s: ChatSubmission) => void;
  onConnect?: () => void;
  onDisconnect?: () => void;
};

export class ChatListener {
  private client: tmi.Client | null = null;
  private opts: ChatListenerOptions;
  private recentUrls = new Map<string, number>(); // normalized URL → timestamp

  constructor(opts: ChatListenerOptions) {
    this.opts = opts;
  }

  private isDuplicate(normalizedUrl: string): boolean {
    const now = Date.now();
    // Clean entries older than 60 seconds
    for (const [k, t] of this.recentUrls) {
      if (now - t > 60_000) this.recentUrls.delete(k);
    }
    if (this.recentUrls.has(normalizedUrl)) return true;
    this.recentUrls.set(normalizedUrl, now);
    return false;
  }

  async start() {
    const client = new tmi.Client({
      options: { debug: false },
      connection: { reconnect: true, secure: true },
      channels: [this.opts.channel.toLowerCase()],
    });

    client.on('connected', () => this.opts.onConnect?.());
    client.on('disconnected', () => this.opts.onDisconnect?.());

    client.on('message', (_channel, tags, message, self) => {
      if (self) return;
      const isMod = !!tags.mod || tags.badges?.broadcaster === '1';
      const isSub = !!tags.subscriber || !!tags.badges?.subscriber;
      const isVip = !!tags.badges?.vip;
      const submitter = tags['display-name'] || tags.username || 'anon';

      // Permission gate
      if (!this.opts.allowAnyone && !(isSub || isMod || isVip)) return;

      // Command gate
      let payload = message;
      if (this.opts.submitCommand) {
        const cmd = this.opts.submitCommand.toLowerCase();
        if (!message.toLowerCase().startsWith(cmd)) return;
        payload = message.slice(cmd.length).trim();
      }

      const urls = extractUrlsFromMessage(payload);
      for (const u of urls) {
        const normalized = normalizeUrl(u);
        if (this.isDuplicate(normalized)) continue;
        this.opts.onSubmission({
          url: u,
          normalizedUrl: normalized,
          kind: detectKind(u),
          submitter,
          isSub,
          isMod,
          isVip,
          message,
          timestamp: Date.now(),
        });
      }
    });

    this.client = client;
    await client.connect();
  }

  async stop() {
    if (this.client) {
      try { await this.client.disconnect(); } catch {}
      this.client = null;
    }
  }
}

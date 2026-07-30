# newsroom

A deck for political &amp; news react streamers. Triage chat-submitted links, get DMCA risk signals, and turn your stream into show notes.

Built with Next.js 14 (App Router), Supabase, Anthropic Claude, and Twitch EventSub webhooks. Deploys entirely on Vercel — no separate worker needed.

## What's in here

```
app/
  page.tsx             ─ landing
  login/               ─ login + OAuth error display
  deck/                ─ streamer's reaction view (single-card focus)
  mod/                 ─ mod triage view (firehose → approved queue)
  setup/               ─ per-stream settings + EventSub status
  api/
    twitch/oauth/      ─ start OAuth
    twitch/callback/   ─ finish OAuth, upsert stream, set session, register EventSub
    twitch/eventsub/   ─ Twitch EventSub webhook handler (receives chat messages)
    twitch/eventsub/status/ ─ check/reconnect EventSub subscription
    queue/             ─ POST submit, GET list, PATCH mutate
    deck/add/          ─ streamer direct-add (URLs + playlist expansion)
    queue/reorder/     ─ drag-drop reorder
    queue/clear/       ─ bulk-reject pending items
    notes/             ─ GET show notes as JSON or Markdown
    setup/             ─ save settings
    auth/              ─ logout
lib/
  url.ts               ─ normalize URLs, detect media kind
  extract.ts           ─ orchestrates extraction per media kind
  extract-article.ts   ─ Mozilla Readability + OpenGraph
  extract-youtube.ts   ─ YouTube page scraping + oEmbed + transcript
  extract-twitter.ts   ─ Twitter/X metadata
  enrich.ts            ─ Anthropic summary + credibility + DMCA risk
  submit-url.ts        ─ shared queue insertion + dedup logic
  search-coverage.ts   ─ Brave Search for related coverage
  twitch-oauth.ts      ─ OAuth helpers
  twitch-eventsub.ts   ─ EventSub verification, subscription management
  supabase.ts          ─ service-role client
  session.ts           ─ signed-cookie session
components/
  SubmissionCard.tsx
  DarkModeToggle.tsx
supabase/
  schema.sql           ─ run this in Supabase SQL editor
```

## Local setup

1. `npm install`
2. Copy `.env.example` to `.env.local` and fill in:
   - **Twitch app** at https://dev.twitch.tv/console
     - OAuth Redirect URL: `http://localhost:3000/api/twitch/callback`
     - Set `NEXT_PUBLIC_TWITCH_CLIENT_ID` and `TWITCH_CLIENT_SECRET`
   - **Supabase project** at https://supabase.com
     - Run `supabase/schema.sql` in the SQL editor
     - Fill in `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`
   - **Anthropic API key** — set `ANTHROPIC_API_KEY`
   - **EventSub secret** — generate with `openssl rand -hex 32`, set as `EVENTSUB_SECRET`
   - **YouTube Data API key** (optional but recommended) — set `YOUTUBE_API_KEY`
   - **Brave Search API key** (optional) — set `BRAVE_SEARCH_API_KEY`
3. `npm run dev` and open http://localhost:3000
4. **Note:** EventSub webhooks require a publicly reachable HTTPS URL. For local dev, use a tunnel like [ngrok](https://ngrok.com/) or test link submission directly via the mod/deck views.

## Deploying to Vercel

1. Push to your repo and import in Vercel.
2. Set the env vars in **Project Settings → Environment Variables**:
   - `NEXT_PUBLIC_APP_URL` = your production URL (e.g. `https://thebroadside.net`)
   - `EVENTSUB_SECRET` = the secret generated above
   - All other vars from `.env.example`
3. Update the **Twitch app OAuth Redirect URL** to `{NEXT_PUBLIC_APP_URL}/api/twitch/callback`.
4. Deploy. On first login, the app automatically creates a Twitch EventSub subscription to receive chat messages.

## How a session flows

1. Streamer clicks **Connect Twitch** on the landing page.
2. Twitch OAuth completes → we upsert a row in `streams`, register an EventSub webhook for their chat, and set a signed cookie.
3. Twitch pushes every chat message to `/api/twitch/eventsub`. The handler extracts URLs, applies permission/command/ignore filters, and adds them to the queue. This works 24/7 — no browser tab needs to be open.
4. Every URL gets enriched inline:
   - For articles: Readability + OpenGraph
   - For YouTube: page scrape + oEmbed + transcript
   - AI enrichment via Claude Haiku: summary, credibility tag, DMCA risk
5. Mods open `/mod` → see incoming links, approve/reject/add notes, and attach a viewer-facing trigger warning to anything that needs one.
6. Streamer opens `/deck` → shows only **approved** items in a drag-sortable sidebar. Trigger warnings can also be added or edited here mid-show, and appear on the overlay immediately.
7. When the streamer hits **Played**, the item is timestamped and copied to `show_notes`.
8. Export to Markdown anytime from `/api/notes?format=markdown`.

## Architectural choices &amp; trade-offs

- **Chat capture uses Twitch EventSub webhooks.** Twitch pushes chat messages to our API endpoint via HTTP — no persistent connection, no separate worker, runs entirely on Vercel. Links are captured even if nobody has the app open.
- **The mod view polls, it doesn't push.** The deck and mod views poll every 3-4 seconds. For v2, Supabase Realtime could replace this.
- **DMCA risk is a heuristic, not legal advice.** We combine a host blacklist (Fox, Disney, sports leagues, music labels) with Claude's classification. Display as a signal, not a guarantee.
- **Service-role Supabase from the server only.** No client-side DB access. RLS is on but we don't grant anon any policies.
- **Two themes, not one.** `app_theme` is a *default* — a mod who explicitly picks High contrast because they can't read the streamer's palette keeps that choice, since only an unset preference falls through to the brand. `overlay_theme` is absolute: it's matching branding on air with nobody around to adjust it, so it gets per-slot colours rather than inheriting the app's six tokens. The overlay reads its theme from the poll rather than the URL, which is the only way a colour change reaches a browser source mid-show.
- **Theme values are validated on write, not on read.** A font family ends up inside both a stylesheet URL and a CSS `font-family`, and colours are written straight into a `<style>`; `lib/theme.ts` normalises colours to `#rrggbb` and restricts families to letters, digits and spaces once, at the point of saving, so no reader has to re-derive the rules.
- **Three warning fields, on purpose.** `content_warning` is AI-guessed and internal (a triage hint on the card). `mod_notes` is an internal production aside. `trigger_warning` is the only one written *for the audience* — the streamer or a mod types it, and it's published verbatim: it opens the `!video` reply and the "Post to chat" message (ahead of the title and url, so it survives Twitch's pinned-message preview), and it's shown on the on-air overlay. Keeping them separate is what lets the first two stay candid.
- **YouTube playlist handling** auto-expands into individual submissions when extracted, then the playlist itself is marked rejected with a `mod_notes` trail.
- **Insert-first dedup** handles concurrent submissions without unique constraints, preserving the allow_duplicates feature.

## License

MIT. Do whatever.

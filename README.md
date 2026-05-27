# newsroom

A deck for political &amp; news react streamers. Triage chat-submitted links, get AI summaries and DMCA risk signals, and turn your stream into show notes.

This is the MVP scaffold — built to run as a Next.js app on Vercel with Supabase for state, and a Twitch chat connection that runs in the browser (no server worker needed for v1).

## What's in here

```
app/
  page.tsx             ─ landing
  login/               ─ login + OAuth error display
  deck/                ─ streamer's reaction view (single-card focus)
  mod/                 ─ mod triage view (firehose → approved queue)
  setup/               ─ per-stream settings
  api/
    twitch/oauth/      ─ start OAuth
    twitch/callback/   ─ finish OAuth, upsert stream, set session
    queue/             ─ POST submit, GET list, PATCH mutate
    extract/           ─ fetches page, runs Readability, calls Claude
    notes/             ─ GET show notes as JSON or Markdown
    setup/             ─ save settings
    auth/              ─ logout
lib/
  url.ts               ─ normalize URLs, detect media kind
  extract-article.ts   ─ Mozilla Readability + OpenGraph
  extract-youtube.ts   ─ YouTube Data API + oEmbed + transcript
  enrich.ts            ─ Anthropic summary + credibility + DMCA risk
  chat-listener.ts     ─ tmi.js wrapper (client-side)
  supabase.ts          ─ service-role client
  session.ts           ─ signed-cookie session
  twitch-oauth.ts      ─ OAuth helpers
components/
  SubmissionCard.tsx
  useChatListener.ts
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
   - **YouTube Data API key** (optional but recommended) — set `YOUTUBE_API_KEY`
3. `npm run dev` and open http://localhost:3000

## Deploying to Vercel

This project follows your existing pattern: commits go to `main`, Vercel deploys.

1. Push to `mikebrownNB/newsroom` (or whatever you name the repo).
2. Import the repo in Vercel.
3. Set the env vars in **Project Settings → Environment Variables**:
   - `NEXT_PUBLIC_APP_URL` = your production URL (e.g. `https://newsroom.vercel.app`)
   - All other vars from `.env.example`
4. Update the **Twitch app OAuth Redirect URL** to `{NEXT_PUBLIC_APP_URL}/api/twitch/callback`.
5. Deploy. The first push to `main` will create a preview; promote to production once Twitch OAuth is working.

## How a session flows

1. Streamer clicks **Connect Twitch** on the landing page.
2. Twitch OAuth completes → we upsert a row in `streams` and set a signed cookie.
3. Streamer opens `/mod` on one screen → it connects to their Twitch chat over IRC (websocket, client-side via tmi.js) and starts harvesting URLs.
4. Every URL gets POSTed to `/api/queue`. The queue route fires `/api/extract` in the background, which:
   - For articles: Readability + OpenGraph
   - For YouTube: Data API + oEmbed + transcript
   - Sends body text to Claude Haiku for summary + credibility + DMCA risk
5. The streamer opens `/deck` on a second screen → shows only **approved** items.
6. When the streamer hits **Played**, the item is timestamped and copied to `show_notes`.
7. Export to Markdown anytime from `/api/notes?format=markdown`.

## Architectural choices &amp; trade-offs

- **Chat listener runs client-side.** This matches existing tools like `twitch-clip-queue`. Pros: free, no server, no Twitch API quota. Cons: requires the mod tab to stay open. For v2 we could move this to a Vercel cron or a small Fly.io worker.
- **The mod view runs the chat listener, not the deck.** This is intentional — the deck is the streamer's focused screen and doesn't need a websocket.
- **DMCA risk is a heuristic, not legal advice.** We combine a host blacklist (Fox, Disney, sports leagues, music labels) with Claude's classification. Display as a signal, not a guarantee.
- **Service-role Supabase from the server only.** No client-side DB access in v1. RLS is on but we don't grant anon any policies.
- **YouTube playlist handling** auto-expands into individual submissions when extracted, then the playlist itself is marked rejected with a `mod_notes` trail.

## Known v1 gaps (planned v2)

- Mod login is the streamer's session. v2: separate mod accounts via a share link.
- No reordering UI yet — uses creation order. v2: drag-and-drop.
- No "related coverage" panel. v2: web search call to find other outlets covering the same story.
- No real-time websocket between mod &amp; deck — uses 3-4s polling. v2: Supabase realtime.
- No `localStorage` cache; refresh = refetch. Fine for v1.

## License

MIT. Do whatever.

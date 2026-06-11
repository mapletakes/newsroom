# Newsroom Quick Add (Chrome/Edge extension)

Add the current page, a link, or a video to your Newsroom streamer deck without
copy/paste or tab-switching.

## Install (load unpacked)

1. In Newsroom, go to **Settings → Quick add** and **Generate add link**. Copy the
   **token** (`nr_…`).
2. Open `chrome://extensions` (or `edge://extensions`).
3. Toggle **Developer mode** on (top right).
4. Click **Load unpacked** and select this `extension/` folder.
5. Click the extension's **Details → Extension options** (or right-click the toolbar
   icon → Options) and paste your **token**. The Newsroom URL is pre-filled; change it
   only if you use a custom domain.

## Use

- **Toolbar button** — click it to add the page you're currently on.
- **Right-click → "Add to Newsroom"** — works on:
  - a **link** (e.g. a video in a YouTube playlist/sidebar → adds that video),
  - a **page** (adds the article you're reading),
  - **selected text** that is a URL,
  - a **video**.
- Paste a **playlist** URL's page and the toolbar button bulk-adds every video.

A small **✓** badge confirms success (**!** on failure). Items land **approved**,
ready on your deck.

## Notes

- Auth is the personal add token; if it leaks, regenerate it in Settings (the old one
  stops working — re-paste the new one here).
- If you move Newsroom to a custom domain, set that URL in the extension options. The
  API allows cross-origin calls (token-gated), so no manifest change is needed.
- This is a load-unpacked dev extension; no Web Store listing required.

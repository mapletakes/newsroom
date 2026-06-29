# The Broadside Quick Add (Chrome/Edge extension)

Add the current page, a link, or a video to your Broadside streamer deck without
copy/paste or tab-switching.

## Install (load unpacked)

1. In The Broadside, go to **Settings → Quick add** and **Generate add link**. Copy the
   **token** (`nr_…`).
2. Open `chrome://extensions` (or `edge://extensions`).
3. Toggle **Developer mode** on (top right).
4. Click **Load unpacked** and select this `extension/` folder.
5. Click the extension's **Details → Extension options** (or right-click the toolbar
   icon → Options) and paste your **token**. The Broadside URL is pre-filled; change it
   only if you use a custom domain.

## Use

- **Toolbar button** — click it to add the page you're currently on (to Ungrouped).
- **Right-click → "Add to The Broadside"** — works on:
  - a **link** (e.g. a video in a YouTube playlist/sidebar → adds that video),
  - a **page** (adds the article you're reading),
  - **selected text** that is a URL,
  - a **video**.
- **Pick a segment** — if your deck has segments, the right-click menu expands into a
  submenu: choose **Ungrouped (no segment)** or any segment by name to drop the item
  straight into that part of the show. With no segments, it's a single "Add to The Broadside".
- Paste a **playlist** URL's page and the toolbar button bulk-adds every video (all into
  the same chosen segment when you pick one).

A small **✓** badge confirms success (**!** on failure). Items land **approved**,
ready on your deck.

## Notes

- Auth is the personal add token; if it leaks, regenerate it in Settings (the old one
  stops working — re-paste the new one here).
- If you move The Broadside to a custom domain, set that URL in the extension options. The
  API allows cross-origin calls (token-gated), so no manifest change is needed.
- The segment submenu refreshes when you change the token/URL and every few minutes
  while the browser is running. If a segment you just created isn't there yet, reopen
  the menu in a moment (or toggle the extension off/on) to force a refresh.
- This is a load-unpacked dev extension; no Web Store listing required.

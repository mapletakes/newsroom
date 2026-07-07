# The Broadside Quick Add (Chrome/Edge/Firefox extension)

Add the current page, a link, or a video to your Broadside streamer deck without
copy/paste or tab-switching.

## Install on Chrome/Edge (Web Store — recommended)

The extension is published and approved on the Chrome Web Store — search for
**"The Broadside Quick Add"** there and install like any extension (works on
Edge too via "Allow extensions from other stores"). Store installs auto-update.

1. In The Broadside, go to **Settings → Quick add** and **Generate add link**. Copy the
   **token** (`nr_…`).
2. Install from the Chrome Web Store.
3. Right-click the toolbar icon → **Options** (or Details → Extension options) and paste
   your **token**. The Broadside URL is pre-filled; change it only if you use a custom domain.

## Install on Chrome/Edge (load unpacked — development only)

For hacking on the extension itself; regular users should use the store build above
(load-unpacked copies never auto-update).

1. Open `chrome://extensions` (or `edge://extensions`).
2. Toggle **Developer mode** on (top right).
3. Click **Load unpacked** and select this `extension/` folder.
4. Set the token in Options as above.

## Install on Firefox (temporary, for testing)

1. Open `about:debugging#/runtime/this-firefox`.
2. Click **Load Temporary Add-on…** and select `manifest.json` in this `extension/` folder.
3. Right-click the toolbar icon → **Manage Extension → Preferences** (or find it in the
   extension's card) to paste your **token**, same as Chrome.

This only lasts until Firefox restarts — Firefox removes temporarily-loaded extensions on
every restart, so you'll need to reload it each session. For a Firefox install that
persists like Chrome's does, the extension needs to go through Mozilla's free
self-distribution signing (see `STORE_LISTING.md` for the Chrome Web Store submission;
the Firefox equivalent is the [Add-on Developer Hub](https://addons.mozilla.org/developers/) —
not yet prepared here).

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
- Token/URL are stored in `storage.local` (not `storage.sync`) — deliberately, so it
  doesn't depend on being signed into a Firefox Account, and stays per-machine rather
  than syncing across browser profiles.
- The manifest's `background` key lists both `service_worker` (Chrome/Edge) and
  `scripts` (Firefox) so the same background.js runs on both — each browser uses the
  one it understands and ignores the other.
- The extension is live on the Chrome Web Store (see `STORE_LISTING.md` for the listing
  content and the update workflow: bump the manifest version, rebuild the zip, re-upload
  in the developer dashboard — store users then auto-update). There's no equivalent
  listing for Firefox's Add-on Developer Hub yet.

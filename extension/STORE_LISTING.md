# Chrome Web Store submission — The Broadside Quick Add

Everything below is ready to paste into the [Chrome Web Store Developer
Dashboard](https://chrome.google.com/webstore/devconsole). The parts I can't do
for you (they need your own Google account and a one-time $5 developer
registration fee) are in **Manual steps**, at the end.

This doc is Chrome-specific. The extension is also Firefox-compatible now (see
`README.md`'s "Install on Firefox" section) — Firefox's equivalent to this whole
doc would be a submission to Mozilla's Add-on Developer Hub, not yet prepared.

## Package

`broadside-quick-add-v1.5.0.zip`, already built in this folder — manifest.json
is at the zip root as required. Rebuild it after any future manifest version
bump with:

```powershell
Compress-Archive -Path manifest.json,background.js,options.js,options.html,icons -DestinationPath broadside-quick-add-vX.Y.Z.zip -CompressionLevel Optimal
```

## Store listing fields

**Title**
```
The Broadside Quick Add
```

**Summary** (single line, ≤132 characters)
```
Right-click any page, link, or video to add it straight to your Broadside streamer deck.
```

**Description**
```
Add the page you're on, a link, or a video to your Broadside streamer deck without copy/paste or switching tabs.

HOW IT WORKS
• Click the toolbar button to add the current page (to Ungrouped).
• Right-click a link, a page, selected text that's a URL, or a video, then choose "Add to The Broadside."
• If your deck has segments, the right-click menu expands into a submenu so you can file the link straight into the right part of the show.
• Paste a playlist page and the toolbar button bulk-adds every video in it.

SETUP
You'll need a Broadside account (thebroadside.net) and an add token from Settings → Quick add. Paste the token into this extension's options page and you're ready to go.

A small checkmark badge confirms success; an exclamation mark means it failed. Items land already approved, ready on your deck.

This extension only talks to the Broadside API to fetch your segment list and submit links — nothing else, no analytics, no ads.

Privacy Policy: https://thebroadside.net/privacy
```

**Category**
```
Productivity
```
(Social & Communication is a reasonable alternative if Productivity gets rejected for any reason.)

**Language**
```
English
```

**Privacy policy URL**
```
https://thebroadside.net/privacy
```

## Single purpose (required field)

```
Adds the page, link, or video the user is viewing to their Broadside streamer deck queue.
```

## Permission justifications (required per-permission in the Privacy Practices tab)

**contextMenus**
```
Used to add the right-click menu item "Add to The Broadside" — and, when the
signed-in streamer has created segments, a submenu letting them choose which
segment to file the link under.
```

**activeTab**
```
Used only when the user clicks the toolbar button, to read the current tab's
URL so it can be submitted. No access to tab content otherwise.
```

**storage**
```
Stores the user's personal Broadside add-token and app URL locally
(chrome.storage.local) so they don't have to re-enter it every time.
```

**alarms**
```
Refreshes the cached list of the streamer's deck segments every 5 minutes, so
the right-click submenu stays current without a network call on every click.
```

**Host permission — thebroadside.net**
```
The extension calls the Broadside API on this domain only, to fetch the
signed-in user's segment list and submit the link/page/video being added.
```

**Host permission — newsroom-psi-five.vercel.app**
```
Legacy domain from before Broadside moved to thebroadside.net. Kept only so
installs still pointed at the old URL keep working during the transition;
functionally identical to the primary host permission above.
```
(Optional cleanup: since this would be the extension's first public listing —
no installed base yet depends on the old domain — you could drop this host
permission from manifest.json before submitting, for a slightly smaller
permission footprint and one less thing to justify. Not required; the extension
works and reviews fine either way.)

## Screenshots

Chrome Web Store requires at least one, up to 5, at 1280×800 or 640×400.
Good candidates to capture locally before submitting:
1. The expanded right-click submenu showing "Add to The Broadside" with a few
   named segments listed underneath.
2. The extension's options page with the token field.
3. A success/failure badge on the toolbar icon after adding a link.

## Manual steps (need your own Google account)

1. Go to the [Developer Dashboard](https://chrome.google.com/webstore/devconsole), sign in, pay the one-time $5 registration fee if you haven't already.
2. Click **New Item**, upload `broadside-quick-add-v1.5.0.zip`.
3. Fill in the listing fields above (Title, Summary, Description, Category, Language, Privacy policy URL).
4. In **Privacy practices**, paste the single-purpose description and each permission justification above, and take the required data-usage disclosure (this extension: doesn't sell data, doesn't use data for purposes unrelated to its core function, doesn't use data to determine creditworthiness/lending).
5. Upload the screenshots.
6. Submit for review. Google's review typically takes a few days to ~2 weeks for a first submission.
7. Once approved, it's live — future updates just need a version bump + re-zip + re-upload (no new review wait for most minor changes, though Google may re-review if permissions change).

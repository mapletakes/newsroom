# Chrome Web Store listing — The Broadside Quick Add

> **Status: PUBLISHED & APPROVED** (July 2026). The submission steps below were
> completed; this doc is kept as the source of truth for the listing content
> and the update workflow.
>
> **Shipping an extension update now means:** bump `version` in manifest.json →
> rebuild the zip (command below) → upload it in the
> [Developer Dashboard](https://chrome.google.com/webstore/devconsole) →
> store installs auto-update after Google processes it (usually quick; may
> re-review if permissions change). A git push alone does NOT update anyone's
> installed extension.

This doc is Chrome-specific. The extension is also Firefox-compatible (see
`README.md`'s "Install on Firefox" section) — Firefox's equivalent to this whole
doc would be a submission to Mozilla's Add-on Developer Hub, not yet prepared.

## Package

`broadside-quick-add-v1.7.0.zip`, already built in this folder — manifest.json
is at the zip root as required. Rebuild it after any future manifest version
bump with (capture.js is required for "Archive this page"; leave out the
README, STORE_LISTING and tests):

```powershell
Compress-Archive -Path manifest.json,background.js,capture.js,options.js,options.html,icons -DestinationPath broadside-quick-add-vX.Y.Z.zip -CompressionLevel Optimal
```

## Store listing fields

**Title**
```
The Broadside Quick Add
```

**Summary** (single line, ≤132 characters)
```
Add pages, links and videos to your Broadside deck or shelf, and archive any page exactly as you see it.
```

**Description**
```
Add the page you're on, a link, or a video to your Broadside deck or shelf without copy/paste or switching tabs — and save a snapshot of any page exactly as you see it, in case the story changes later.

ADD TO YOUR DECK OR SHELF
• Click the toolbar button to add the current page to your default destination.
• Right-click a link, a page, selected text that's a URL, or a video, then choose "Add to The Broadside."
• Pick where it goes: the live deck (Ungrouped or a specific segment) or one of your shelves for pre-show research. The menu stays in sync with your account.
• Paste a playlist page and the toolbar button bulk-adds every video in it.

ARCHIVE THIS PAGE
• Right-click any page and choose "Archive this page in The Broadside."
• The extension captures the page as your browser shows it — including article text a site draws with scripts and pages behind a paywall you're signed in to — and saves it as a frozen, script-free snapshot with its own link.
• Works on sites that block automated archiving, because it uses the page you already have open.
• Your details are scrubbed before anything leaves your browser: scripts, account menus, avatars and sign-in widgets, email addresses outside the article, and attributes that name users or sessions. Add your own name or other words to remove in the options page.
• The snapshot opens in a new tab so you can check it. Snapshots are viewable by anyone with the link, so archive only pages you're comfortable sharing, and you can delete a snapshot from your deck at any time.
• Nothing is captured unless you choose "Archive this page."

SETUP
You'll need a Broadside account (thebroadside.net) and an add token from Settings → Quick add. Paste the token into this extension's options page and you're ready to go.

A small checkmark badge confirms success; an exclamation mark means it failed. Added items land already approved, ready on your deck.

This extension only talks to the Broadside API — to fetch your segment and shelf lists, submit links, and save pages you choose to archive. No analytics, no ads, and nothing runs on a page unless you ask.

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
Adds the page, link, or video the user is viewing to their Broadside streamer deck queue, and archives the page as the user sees it.
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
Used only when the user clicks the toolbar button or a context-menu item, to
read the current tab's URL so it can be submitted, and — only when they choose
"Archive this page" — to capture that tab's content. No access to tabs
otherwise.
```

**scripting**
```
Used only when the user chooses "Archive this page" in the right-click menu.
chrome.scripting.executeScript runs two things in that one tab, under the
activeTab grant: a one-line function that passes the user's own "words to
remove" list (from the options page) to the next script, and capture.js, a file
bundled in this extension. capture.js makes a copy of the page's DOM as the
browser currently displays it, then strips scripts, account menus, sign-in
widgets, email addresses and user/session-identifying attributes from the copy
(never from the live page, which is left unchanged). The copy is returned to
the background script, which sends it to the user's own Broadside account to
be saved as a snapshot. A "snapshot" lets the user preserve what a page said
when they viewed it. The extension never injects code on any page unless the
user picks that menu item, never loads or runs remote code, and does not use
the scripting permission to modify pages, inject UI, or observe browsing.
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
   named segments and shelves listed underneath.
2. The right-click menu on an article showing "Archive this page in The
   Broadside", next to the finished snapshot open in a new tab.
3. The extension's options page with the token field and the words-to-remove list.
4. A success/failure badge on the toolbar icon after adding a link.

## Manual steps (need your own Google account)

1. Go to the [Developer Dashboard](https://chrome.google.com/webstore/devconsole), sign in, pay the one-time $5 registration fee if you haven't already.
2. Click **New Item**, upload `broadside-quick-add-v1.7.0.zip`.
3. Fill in the listing fields above (Title, Summary, Description, Category, Language, Privacy policy URL).
4. In **Privacy practices**, paste the single-purpose description and each permission justification above, and take the required data-usage disclosure (this extension: doesn't sell data, doesn't use data for purposes unrelated to its core function, doesn't use data to determine creditworthiness/lending).
5. Upload the screenshots.
6. Submit for review. Google's review typically takes a few days to ~2 weeks for a first submission.
7. Once approved, it's live — future updates just need a version bump + re-zip + re-upload (no new review wait for most minor changes, though Google may re-review if permissions change).

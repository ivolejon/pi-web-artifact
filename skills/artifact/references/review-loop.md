# Review loop

The loop is short because the surface is part of the app the user is already in: write the artifact, point
the user at the Artifact tab, and answer the comments that come back as a chat message.

## The surface

The **Artifact** tab is a PI WEB plugin in this package, installed as a symlink in
`~/.pi-web/plugins/artifact`. It is browser-only: it reads workspace files through the host's own
file capability, so it opens no port and needs no service restart. See its `README.md` for install and
removal.

What it does with an artifact:

- Binds itself to the open conversation. It shows every `.html` file under
  `test-results/artifact/<session id>/` as its own tab, newest first, and re-lists on agent activity and on
  **Refresh**. With no conversation selected it shows a notice, and with a different conversation selected
  it shows that conversation's pages, not yours.
- Renders the selected file in an `iframe` with `sandbox="allow-scripts"` and no `allow-same-origin`. The
  page therefore runs at an opaque origin and cannot read PI WEB, its cookies or its DOM.
- Blocks every network request with `default-src 'none'`. A sibling stylesheet is read through the file API
  and inlined; a sibling image is resolved to the host's preview URL, which is the only permitted origin.
- Injects its own annotation script after the artifact's content. That script owns the click and selection
  handling; the artifact itself needs no script and should not contain one.
- Re-reads the file when it changes on disk, keeping the user's comments, open comment field and scroll position.
  It compares the artifact's modification time every two seconds while the tab is visible, because a write
  from a terminal does not always reach the plugin as a host invalidation.
- Selects itself when a new page appears for the open conversation, which is why the skill stays silent. A
  revision of a page that already exists does not move the tab.

## The binding

A workspace holds many conversations, and each can have its own page. The session id in the path is what
keeps them apart:

- The agent writes to `test-results/artifact/$PI_SESSION_ID/<topic>/artifact.html`.
- The tab lists only the selected conversation's directory, so a page written here cannot be reviewed in
  another conversation.
- **Send to chat** stages the comments for that same conversation. Comments and the open comment field are kept per
  page and conversation, so switching tool tabs and coming back, or a revision landing mid-review, does not
  lose them. Switching conversation starts clean, because they belong to the page they were written on.
- A chat or Files link opens in the tab only while it points at the open conversation's directory.

If `PI_SESSION_ID` is empty, there is no way to bind the page. Say so instead of writing the file somewhere
the tab will not read.

## What the comments look like

**Send to chat** stages the comments as a chip and the user presses Send. The message arrives like this:

```text
Review comments on test-results/artifact/<session id>/brief-flow/artifact.html

1. <h1> body > main > h1
   Rubriken ska nämna kunden, inte ändringen.
2. text in p "Two sentences at most: what this page is for..."
   Korta inledningen till en mening.
```

Read each entry as: target, then the requested change. A text comment quotes the selection, never a rewritten
version of it. Apply every entry, then report what changed. If an entry is ambiguous, ask about that entry
instead of guessing a redesign.

## Refresh and revisions

The tab reloads the artifact within a couple of seconds of a change on disk, and it keeps the comments, the
open comment field and the scroll position. A revision therefore costs the user no reload and no tab switch.
Pressing **Refresh** re-lists the directory.

Because the tab reloads on every change, write the artifact in one pass where you can. A file saved in
several steps is re-read between them, and the user may briefly see a half-written page.

## When the tab cannot help

| Situation | What to do |
| --- | --- |
| No Artifact tab in the tool row | The plugin is not installed or is disabled. Say so and give the install command from this package's `README.md`. |
| "This conversation has no artifact yet" | Nothing matches `test-results/artifact/<session id>/*/*.html`. Check the path you wrote, and that the session id is this conversation's. |
| "No conversation selected" | The tab needs an open conversation. Select one and it shows that conversation's page. |
| A stylesheet warning | The sibling stylesheet was not readable from the workspace. Keep the sheet beside the artifact. |
| An image does not appear | The image is remote, or it is not in the workspace. Remote resources stay blocked. |
| The page stops halfway | The file is larger than the surface reads. Split the artifact. |
| Send to chat copies instead of staging a chip | No conversation was selected when the tab opened. Select one and send again, or paste the clipboard. |

Without the tab, a Markdown link to the artifact path opens it in the Files preview, and the user can send
comments as plain text. That is an honest fallback, not a review surface.

## Etiquette

- One artifact per topic. A second artifact for the same topic splits the comments.
- Point at the Artifact tab once, with the path. Do not repeat the pointer in every reply.
- Do not describe the page as monitored, live or watched. The user's message is what brings comments.
- Reuse the tab for the revision rather than writing a new file, so the comments keep their place.
- Old artifacts stay on disk under the session's directory. Delete a topic's directory when it is done,
  unless the user wants the page kept.

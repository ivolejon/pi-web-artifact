---
name: artifact
description: Explain the current topic visually with the smallest view that makes the point - pseudocode, call trees, file trees, inline diagrams, diffs - and, when a point is too dense for prose, build one focused HTML artifact in the working repository's own design system and open it in PI WEB's Artifact tab, where the user annotates elements and selected text and sends the comments back as a chat message. Use when the user asks to see, compare, discuss or decide something visually, or invokes /skill:artifact.
compatibility: PI WEB with the Artifact tab from this package installed and enabled, and a workspace the agent can write to. No network, no CLI and no local port are needed.
disable-model-invocation: true
---

# Visual review

Two halves of one loop. First pick the smallest visual that explains the topic. Then, when a visual is too
dense for a chat message, build one HTML artifact in the portal's design system and open it in the Artifact
tab, where the user annotates what to change and the comments come back to you as an ordinary message.

This skill is not `show-me`, which records a captioned movie of a portal flow, and it is not
`align-with-ref`, which measures a page against the reference portal. Use those for their own jobs.

Read `references/forms.md` before choosing a form, `references/artifact.md` before writing HTML, and
`references/review-loop.md` before handing the page over.

The examples below name this skill's own directory as `$SKILL_DIR`: the absolute path Pi reports for this
`SKILL.md`. They run from the repository you are describing, and they write into that repository.

## Stay silent

The page is the answer. Do not write a chat message, a summary, a confirmation, a list of what you did, or
a pointer to the Artifact tab. Do not ask the user to look at it. The tab opens on its own when the page is
written, so there is nothing to announce.

This request is the whole turn: build the page, write it, stop. A silent turn is the correct result, not a
truncated one.

The one exception is a genuine block: nothing in the conversation identifies what to show, or the file
cannot be written. State that in one sentence and stop.

## Understand the request

Accept the text after `/skill:artifact`. Identify the subject, the reader, the question to answer and
the decision to support. Read the code, the spec or the change under discussion first: a visual that uses
invented names teaches the reader something false. Infer the subject from the conversation when the
command carries no text; that is the normal case.

## Pick the smallest form

`references/forms.md` holds the catalog, the choosing table and the diff shapes. In a chat answer the
smallest view wins. Under this skill the answer is a page, so choose the page shape that carries the point:
a comparison, a plan with decisions, a record set, or a diagram with labels and a legend. One artifact per
topic, not a site.

## Build the artifact

1. Create the run directory under this conversation's session, and copy the two assets:
   `mkdir -p "test-results/artifact/$PI_SESSION_ID/<topic>" && cp "$SKILL_DIR/assets/artifact.css" "$SKILL_DIR/assets/artifact-template.html" "test-results/artifact/$PI_SESSION_ID/<topic>/"`
   Rename the template to `artifact.html`, then replace its content.

   The session id is what binds the page to this conversation: the Artifact tab lists only
   `test-results/artifact/<session id>/`, and the comments travel back to the same conversation. Pi sets
   `PI_SESSION_ID` for every command. If it is empty, stop and say the page cannot be tied to the session
   rather than writing it somewhere the tab will not show.
2. Generate the tokens from the design source of the repository you are working in:
   `node "$SKILL_DIR/scripts/design-tokens.mjs" --out "test-results/artifact/$PI_SESSION_ID/<topic>/tokens.css" --json`
   It discovers the project's stylesheet and inlines its local fonts. Read the `mapping` list before you
   style anything: it names the palette the page will actually use. Pass `--css` when you already know the
   source, and pass the font stylesheets too so the faces travel with the page. Exit code 3 means nothing
   was found; the neutral defaults in `artifact.css` then carry the page.
3. Write against `references/artifact.md`: one claim in the title, real labels and numbers, the semantic
   names from `tokens.css`, no horizontal overflow at 390px or 1440px.
4. Keep it self-contained. The review surface blocks every network request, so no CDN, no remote font and
   no remote image may appear in the page.

The Artifact tab is the check. It renders the page in the same browser the user reads it in, so a stray
linked font, a remote asset or a table that overflows shows up there, on the real page, instead of in a
separate pass you would have to reproduce. Do not open a second browser to inspect it, and never capture
the page as an image.

The directory `test-results/artifact/` is ignored by git, so an artifact is a working surface, not a
deliverable. Commit one only when the user asks to keep the page, and then say that it will be committed.

## Hand it over

The tab opens within a couple of seconds of the file landing, and it belongs to this conversation. Write the
file and stop; there is nothing to announce and no review UI to build. Do not describe the page as watched
or live. The comments arrive in this conversation when the user sends them, and another conversation never
sees this page.

## Read the comments and iterate

The comments arrive as a normal message, in the shape described in `references/review-loop.md`: a header with
the artifact path, then one numbered entry per note with the selector or the quoted text, then what the
user wants changed. Apply them to the same file. The tab notices the new content, re-reads it and keeps the
user's comments, so the user can review the revision in the same tab without a reload.

After applying a batch, reply in the chat with what changed, briefly; that reply answers a message the user
wrote, so it is a normal turn. The silent rule applies to the request that builds a page, not to a
conversation about it. Build a new artifact only when the topic changes.

## Boundaries

- The surface blocks network access and runs the page at an opaque origin, so the artifact cannot read the
  app, its cookies or its DOM. That protects the app, not the repository: an artifact is a plain file in
  the workspace, so no secrets, tokens or real customer data may appear in it.
- Illustrate customer work with synthetic data, and say it is synthetic in the page.
- No emoji, no exclamation marks, no invented metrics. Every number in an artifact traces to a file or a
  command output you can name.
- Write Swedish artifact copy in klarspråk per `docs/klarsprak.md`, and English copy per
  `docs/asd-ste100.md`.

## Deliver honestly

Report the artifact path, what it shows, and the one decision the page supports. Name what is mock or
synthetic. Do not claim the user reviewed anything: only their message with comments proves that.

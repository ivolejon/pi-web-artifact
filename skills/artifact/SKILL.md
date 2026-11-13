---
name: artifact
description: Explain the current topic visually with the smallest view that makes the point - pseudocode, call trees, file trees, inline diagrams, diffs - and, when a point is too dense for prose, build one focused HTML artifact in the working repository's own design system and open it in PI WEB's Artifact tab, where the user annotates elements and selected text and sends the comments back as a chat message. Use when the user asks to see, compare, discuss or decide something visually, or invokes /skill:artifact.
compatibility: PI WEB with the Artifact tab from this package installed and enabled, and a workspace the agent can write to. The build runs in a tracked subsession where PI WEB provides one, and inline otherwise. No network, no CLI and no local port are needed.
disable-model-invocation: true
---

# Visual review

Two halves of one loop. First pick the smallest visual that explains the topic. Then, when a visual is too
dense for a chat message, build one HTML artifact in the portal's design system and open it in the Artifact
tab, where the user annotates what to change and the comments come back to you as an ordinary message.

The build is delegated to a tracked subsession, so the code reading and the HTML writing stay out of the
conversation that asked for the page. The page still belongs to that conversation, and the comments still
arrive there.

This skill is not `show-me`, which records a captioned movie of a portal flow, and it is not
`align-with-ref`, which measures a page against the reference portal. Use those for their own jobs.

The subsession reads `references/forms.md` before choosing a form, `references/artifact.md` before writing
HTML, and `references/review-loop.md` before handing the page over.

The examples below name this skill's own directory as `$SKILL_DIR`: the absolute path Pi reports for this
`SKILL.md`. They run from the repository you are describing, and they write into that repository.

## Stay silent

The page is the answer. Do not write a chat message, a summary, a confirmation, a list of what you did, or
a pointer to the Artifact tab. Do not ask the user to look at it. The tab opens on its own when the page is
written, so there is nothing to announce. The handoff is silent too: no "building this now", no progress
note, and no report when the subsession returns.

This request is the whole turn: brief the subsession, let it write the page, stop. A silent turn is the
correct result, not a truncated one. A returned subsession result is not an invitation to summarise; the
page is already in its tab.

The one exception is a genuine block: nothing in the conversation identifies what to show, the file cannot
be written, or the subsession reports that it could not build the page. State that in one sentence and
stop.

## Understand the request

Accept the text after `/skill:artifact`. Identify the subject, the reader, the question to answer and
the decision to support. Read the code, the spec or the change under discussion first: a visual that uses
invented names teaches the reader something false. Infer the subject from the conversation when the
command carries no text; that is the normal case.

This is also the brief. Gather it before spawning, and cite the files, symbols and command output the page
may use: the subsession starts with no history and sees only what you write into its prompt. Do not build
anything first; a half-built page here duplicates the work and spends the context the review needs.

## Hand the build to a subsession

The request that creates a page is built in a tracked subsession (`spawn_subsession`), not in this
conversation. Use the tracked tool, not `spawn_session`: an independent session returns nothing here.

1. Read this conversation's session id with `printf '%s\n' "$PI_SESSION_ID"`. The page is bound to the
   session whose directory holds it, and the subsession has an id of its own, so the id has to travel in the
   brief. If it is empty, stop and say the page cannot be tied to the conversation.
2. Name the topic directory yourself, in kebab-case, so the page and its revisions share one directory.
3. Spawn one subsession from this conversation's working directory. The brief stands on its own, because
   the subsession inherits none of this conversation:

   ```text
   Build one artifact for an /skill:artifact request. You are the subsession: build the page yourself and
   do not spawn a subsession of your own.

   Read <absolute path of this SKILL.md> and follow its "Pick the smallest form", "Build the artifact" and
   "Hand it over" sections. Read <skill dir>/references/forms.md, artifact.md and review-loop.md first.

   The page belongs to the parent conversation, whose session id is <parent session id>. Write
   test-results/artifact/<parent session id>/<topic>/artifact.html and its tokens.css there, and never
   under your own PI_SESSION_ID: the Artifact tab lists only the parent's directory and the comments
   return to the parent. Do not commit.

   Request: <the text after /skill:artifact, verbatim; say so when it carried none>
   Subject: <what to depict, in the repository's own names>
   Reader: <who reads the page>
   Question it answers: <one sentence>
   Decision it supports: <one sentence>
   Facts: <the files, symbols, line references or command output the page may cite, and nothing else>
   Language: <the language of the copy>
   Repository: <absolute path of the repository the page describes, whose design system it uses>

   Reply with one line only: the artifact path, then the decision the page supports. No summary, no
   description of the page, no questions.
   ```

4. Stop. Do not create the directory, run the token script or draft HTML here, and do not repeat the path
   when the result arrives.

Without the tracked-subsession tools, which PI WEB provides only when `spawnSessions` and `subsessions` are
enabled, build the page inline with the sections below and stay just as silent.

The next three sections are the subsession's instructions. **Read the comments and iterate** is yours, and
the boundaries hold for the page whoever writes it.

## Pick the smallest form

`references/forms.md` holds the catalog, the choosing table and the diff shapes. In a chat answer the
smallest view wins. Under this skill the answer is a page, so choose the page shape that carries the point:
a comparison, a plan with decisions, a record set, or a diagram with labels and a legend. One artifact per
topic, not a site.

## Build the artifact

1. Create the run directory under the conversation the brief names, and copy the two assets. Use the parent
   session id from the brief; when you build inline, that id is `$PI_SESSION_ID`:
   `mkdir -p "test-results/artifact/<session id>/<topic>" && cp "$SKILL_DIR/assets/artifact.css" "$SKILL_DIR/assets/artifact-template.html" "test-results/artifact/<session id>/<topic>/"`
   Rename the template to `artifact.html`, then replace its content.

   The session id is what binds the page to a conversation: the Artifact tab lists only
   `test-results/artifact/<session id>/`, and the comments travel back to the same conversation. In a
   subsession your own `PI_SESSION_ID` is the wrong one, and a page written under it lands in a tab the user
   is not sitting in. If no id is available, stop and say the page cannot be tied to the session rather than
   writing it somewhere the tab will not show.
2. Generate the tokens from the design source of the repository you are working in:
   `node "$SKILL_DIR/scripts/design-tokens.mjs" --out "test-results/artifact/<session id>/<topic>/tokens.css" --json`
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

The tab opens within a couple of seconds of the file landing, and it belongs to the conversation the brief
named. Write the file and stop; there is nothing to announce and no review UI to build. This section is the
subsession's instruction: the conversation that asked for the page has nothing to write and nothing to
report. Do not describe the page as watched or live. The comments arrive in this conversation when the user
sends them, and another conversation never sees this page.

## Read the comments and iterate

The comments arrive as a normal message, in the shape described in `references/review-loop.md`: a header with
the artifact path, then one numbered entry per note with the selector or the quoted text, then what the
user wants changed. Apply them to the same file. The tab notices the new content, re-reads it and keeps the
user's comments, so the user can review the revision in the same tab without a reload.

A revision is not delegated. It answers a message the user wrote in this conversation, so apply it here,
with the conversation's own context; a subsession would have to be briefed all over again for a change of a
heading.

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

The subsession's one-line reply carries the artifact path and the one decision the page supports. Keep it,
and answer with it when the user asks what the page shows. Name what is mock or synthetic. Do not claim the
user reviewed anything: only their message with comments proves that.

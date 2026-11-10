# Forms

One view per point. Keep prose to the two sentences the view supports, and put the visual next to them.
Using one form well beats using four forms adequately: a request that needs a call tree and a diff needs
two blocks, not a slide deck.

## Choosing

| The reader needs to | Use |
| --- | --- |
| Follow logic, a rule or an algorithm | pseudocode block |
| See what calls what at runtime | call tree |
| See UI structure, state and ownership | component tree, with the file that owns it |
| See where code lives or how a refactor moves it | file tree |
| See exactly what changes | diff |
| Understand a flow, a boundary or a concept | inline SVG diagram |
| Scan many records at once | table, in an artifact |
| Compare two real screens of the product | artifact that puts the two screens side by side |
| Support a decision with several parts | artifact with sections and one call to action |
| Watch the real portal behave | `show-me`, not this skill |

## Pseudocode

Use when the point is the rule, not the syntax.

```text
on(save)
  if content is unchanged
    return cached result
  write new content
  return fresh result
```

## Call tree

Name the functions that actually exist. Indentation is the call, not a folder.

```text
submitForm
  createSession
    persistPrompt
    launchAgent
  navigateToSession
```

## Component tree

Include the state hook, the module boundary or the file that matters. Omit the props nobody is asking
about.

```tsx
<ProjectWorkspacePage>            apps/web/src/features/project-workspace/
  useProjectWorkspace()
  <CardHeader>
    <StatusPill>                   apps/web/src/components/ds/status-pill.tsx
```

## File tree

A comment per line says what the directory is responsible for. Keep it shallow: the reader is asking about
ownership, not about every file.

```text
apps/web/src/
├── features/       # one folder per portal surface
├── components/ds/  # the shared card, button, pill and dialog
└── lib/            # the generated API client and helpers
```

## Diff

Use a diff when the surrounding shape already exists and the point is the change. Match the shape to the
topic: a component diff for UI, a path diff for layout, a call diff for control flow, an indented diff for
state or logic.

```diff
 <ProjectWorkspacePage>
   useProjectWorkspace()
   <CardHeader>
+    <StatusPill tone="good">Delivered</StatusPill>
   <ProjectTimeline>
```

```diff
 apps/web/src/
 ├── features/
+│   └── planning/       # the new surface
 ├── components/
-└── lib/api.ts
+└── lib/
+    ├── api.ts
+    └── format.ts
```

```diff
 on(save)
-  write content
+  if content is unchanged
+    return cached result
+  write new content
+  invalidate cache
```

## Inline SVG diagram

For a flow, a boundary, a state machine or an architecture sketch, hand-author inline SVG with the sheet's
diagram classes (`.diagram`, `.fill-quiet`, `.fill-accent`, `.fill-good`, `.stroke`, `.label-strong`). Give
the `<svg>` a `role="img"` and an `aria-label` that states the claim, and keep the `viewBox` near 640 wide.

Do not put a Mermaid diagram in an artifact. The review surface blocks every network request and runs no
diagram runtime, so a `.mermaid` block stays source text there. Mermaid belongs in chat and in Files, where
PI WEB's own Mermaid plugin renders it. Inside an artifact, draw the diagram as inline SVG.

## Table

Turn many records into one scan. Put it in an artifact, keep it to three or four columns, right-align
numbers with `class="num"`, and state the source in the card header. Never paste a table of invented
figures: if the numbers are illustrative, say so in the meta line.

## A capture of the product, never of the artifact

One case wants an image: the subject is an existing screen of the running portal, and a drawing of it would
be a guess. Then capture the real page, describe its state (route, role, seeded data) in the caption, put
the file beside the artifact and reference it with a relative path. The committed captures in
`apps/web/screenshots/portal/` show existing surfaces, and the `show-me` skill is the tool when the user
wants motion rather than a still.

That is the only capture in this workflow. Never capture the artifact itself: the page is already rendered
in the Artifact tab, so a screenshot of it is a worse copy that can drift from the page, and it costs a
browser round trip to produce. The artifact is the deliverable; an image inside it is evidence about
something else.

## Keep the short prose short

Skip the preamble. State the claim, show the view, name the consequence. When the user has to choose, name
the options and the default. When the topic raises a risk, state it in one line rather than dressing it as
a callout.

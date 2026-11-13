# Artifact

An artifact is a page the user reads and annotates. It answers one question and asks for one decision, and
it is worth building only when the answer needs sections, comparisons, a table or an interactive control.

## Design source

Take the look from the repository the artifact is about, and generate it rather than typing hex codes.
`scripts/design-tokens.mjs` discovers the project's stylesheet, copies its custom properties and its local
font files into `<run>/tokens.css`, and maps them onto the semantic names `artifact.css` reads:

```bash
node "$SKILL_DIR/scripts/design-tokens.mjs" \
  --out "test-results/artifact/<session id>/<topic>/tokens.css" --json
```

- Without `--css` it discovers: `style.css`, `styles.css`, `globals.css`, `theme.css`, `tokens.css` and
  friends first, then any stylesheet that declares custom properties, skipping build output and
  `node_modules`. It prints which file won and which alternatives it skipped.
- Pass `--css` when you already know the design source, and pass the font stylesheets too, so the faces
  travel with the page:
  `--css apps/web/src/styles.css --css apps/web/node_modules/@fontsource/albert-sans/400.css`.
- Exit code 3 means no design source was found. Then the page renders with the neutral defaults built into
  `artifact.css` and nothing is reported to the user.
- The JSON summary lists every mapped name. Read it before styling: `accent` may come from `--brand-orange`
  in one repository and `--color-primary` in another.

The semantic names, and what they mean:

| Name | Meaning |
| --- | --- |
| `--page` | the page background |
| `--card` | a raised surface inside the page |
| `--ink`, `--ink-2`, `--muted` | primary text, secondary text, quiet labels |
| `--line` | hairlines and table rules |
| `--accent`, `--accent-ink` | the one interactive accent, and text on it |
| `--positive`, `--negative` | done and danger, never decoration |
| `--radius`, `--radius-field` | card and field corners |
| `--font-sans`, `--font-mono` | text and technical labels |

Tints are derived with `color-mix()` from those names, so a page never needs a second palette.

What the script cannot do, and what to do instead:

- **A theme that lives in JavaScript** (CSS-in-JS, a runtime theme object): pass the stylesheet that holds
  the actual values, or copy the few colours into `tokens.css` by hand after the run and say so.
- **A palette that lives only in a Tailwind config**: the generated sheet has no colours from it. Read the
  config, take the values, and add a `:root` block to `tokens.css` that maps them. Do not install Tailwind.
- **Remote fonts**: the surface blocks network access, so a Google Fonts link never loads. The script inlines
  local files and leaves remote ones out with a warning. Fall back to the project's font stack.

A mock of a portal screen must look like the portal, so that the user judges the product and not the
drawing. Do not reach for Tailwind, a component kit or a generic slide look.

## Files

Three files in the run directory: `artifact.html`, `artifact.css` copied from the skill, and the generated
`tokens.css`.

```bash
mkdir -p "test-results/artifact/<session id>/<topic>"
cp "$SKILL_DIR/assets/artifact.css" "$SKILL_DIR/assets/artifact-template.html" \
   "test-results/artifact/<session id>/<topic>/"
mv "test-results/artifact/<session id>/<topic>/artifact-template.html" \
   "test-results/artifact/<session id>/<topic>/artifact.html"
node "$SKILL_DIR/scripts/design-tokens.mjs" \
   --out "test-results/artifact/<session id>/<topic>/tokens.css" --json
```

The session id segment is not decoration. The Artifact tab is a workspace panel, and several conversations
share one workspace, so the tab lists only `test-results/artifact/<session id>/` and the comments return to
that conversation. Write the page anywhere else and the tab will not show it.

The id is the conversation the page belongs to. When you build inline that is `$PI_SESSION_ID`; when the
build is delegated, your own `PI_SESSION_ID` belongs to the subsession and is the wrong one, so use the
parent conversation's id from the brief.

`test-results/` is ignored by git, so an artifact is a working surface, not a deliverable. Put it somewhere
else only when the user asks to keep the page, and then say that it will be committed, keeping the same
`artifact/<session id>/<topic>/` shape.

Fonts travel as data URLs in `tokens.css`. That is deliberate: the Artifact tab renders the page in a
sandboxed iframe whose origin is opaque, and the surface blocks every network request, so a linked `woff2`
would fail silently and drop the page to a system font. Do not switch the sheet back to linked font files.

Never capture the artifact as an image. The page is the artifact and the Artifact tab renders it; a
screenshot of it is a second, worse copy that drifts from the file. An image *inside* the page is allowed
when the subject is a real screen of the product, as `references/forms.md` describes.

Two resource rules follow from that sandbox:

- A sibling stylesheet is read through the workspace file API and inlined. Keep `tokens.css` and
  `artifact.css` beside the artifact and reference them as `./tokens.css` and `./artifact.css`.
- A sibling image is resolved through the host's preview URL, which is the one request the policy allows.
  Remote images, CDN stylesheets and remote fonts stay blocked. Inline a small image as a data URL, or put
## Skeleton

`assets/artifact-template.html` is the shape to copy: an eyebrow, one claim as the `h1`, a two-sentence
lede, then sections. The sheet's classes:

| Class | Use |
| --- | --- |
| `.page` | the centred column, 1120px wide, 48/32 padding |
| `.eyebrow` | mono, uppercase, mute: the surface or the change this page is about |
| `h1`, `.lede` | the claim and its two-sentence support |
| `.card`, `.card--muted`, `.card--turn` | white section, quiet section, "your move" section |
| `.card-head` | title row with room for a `pill` and a right-aligned caption |
| `.pill`, `.pill--good`, `.pill--warn` | inline status labels |
| `.grid-2`, `.grid-3`, `.stack` | equal-height columns that fold to one column below 860px |
| `.table-wrap` + `table` | records, wrapped and scrollable |
| `pre` with `.ctx`, `.add`, `.del` | code and diffs |
| `.diagram` + the `svg` classes | inline diagrams |
| `.note` | the one callout the reader must not miss |
| `.rise` | one entrance; dropped under `prefers-reduced-motion` |

Add a section-local `<style>` block only for a view the sheet does not cover, and use the variables rather
than raw hex.

## Layout rules

- Front-load: the claim in the `h1`, the decision in the first screen, the evidence below it.
- One idea per section. Three to six sections is a page; twelve is a document nobody annotates.
- Compare in equal columns. A before/after pair reads as a comparison only when the two cards share a row
  and a height.
- Never let the page scroll sideways. The sheet already applies the layout safety learned from the review
  surface: `box-sizing`, wrapping for headings, paragraphs and cells, `max-width: 100%` on media, and
  `minmax(0, 1fr)` tracks in its own grids. Keep those guards when you add a nested grid or flex row, and
  give long identifiers a deliberate wrap or truncation.
- A diagram keeps a legible size and scrolls inside its card on a narrow screen. If it needs that scroll,
  say so in a `.caption` under it, or rebuild it to fit 390px.
- Keep tables to three or four columns. Wrap, do not crush.

## Copy

- Swedish by default in this repository: follow `docs/klarsprak.md`. English copy follows
  `docs/asd-ste100.md`.
- Sentence case. No emoji, no exclamation marks, no "seamless" or "powerful".
- Active voice, and name the actor: "API:et sparar projektet" rather than "Projektet blir sparat".
- Real labels: route names, component names, endpoint paths and file paths from the repository.
- Every figure has a source. If a number is illustrative, label it as synthetic in the same card.
- An annotation needs a target sentence the reader can point at, so keep one decision per section.

## The tab is the check

There is no separate inspection pass. The Artifact tab renders the file in the browser the user reads it in,
then keeps it current: a change on disk is re-read within a couple of seconds. A font that did not load, a
remote asset, or a table that overflows is visible there on the real page, in the state the user sees it.

Write to the rules above instead: the sheet beside the artifact, no remote references, wrapping guards on
nested grids, and a title that states the claim. Read the page once as the user will, and ask yourself
whether they can answer the question and name the decision without asking you.

The panel has no download: the page lives in the workspace, and the file plus its two stylesheets is the
copy to hand to someone outside PI WEB.

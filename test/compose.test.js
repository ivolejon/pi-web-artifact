import test from "node:test";
import assert from "node:assert/strict";
import { composeArtifactDocument, feedbackText } from "../browser/compose.js";

// The composer resolves preview URLs against the host page. Node has no window, so the one test that
// exercises a local image supplies the two fields it reads.
globalThis.window = { location: { href: "https://pi.example/workspace" } };

const ARTIFACT = (head, body = "<p>Hello</p>") => `<!doctype html>
<html lang="en"><head><meta charset="utf-8">${head}</head><body>${body}</body></html>`;

function filesFrom(contents, extra = {}) {
  const reads = [];
  return {
    reads,
    ...extra,
    readFile: async (path) => {
      reads.push(path);
      if (!(path in contents)) throw new Error(`No such file: ${path}`);
      return { content: contents[path] };
    },
  };
}

test("inlines a sibling stylesheet and escapes its closing tag", async () => {
  const files = filesFrom({
    "root/topic/artifact.css": "body { color: red; } p::after { content: \"</style>\"; }",
  });
  const { document, sheets, warnings } = await composeArtifactDocument({
    html: ARTIFACT(`<link rel="stylesheet" href="./artifact.css">`),
    path: "root/topic/artifact.html",
    files,
  });

  assert.deepEqual(files.reads, ["root/topic/artifact.css"]);
  assert.deepEqual(sheets, ["root/topic/artifact.css"]);
  assert.deepEqual(warnings, []);
  assert.match(document, /body \{ color: red; \}/u);
  assert.match(document, /<\\\/style>/u);
  assert.equal((document.match(/<\/style>/gu) ?? []).length, 1);
  assert.doesNotMatch(document, /<link\b/iu);
});

test("reports a stylesheet that cannot be read and drops the link", async () => {
  const { document, sheets, warnings } = await composeArtifactDocument({
    html: ARTIFACT(`<link rel="stylesheet" href="./missing.css">`),
    path: "root/topic/artifact.html",
    files: filesFrom({}),
  });

  assert.deepEqual(sheets, []);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /Stylesheet not readable/u);
  assert.doesNotMatch(document, /<link\b/iu);
});

test("leaves a remote stylesheet out of the document", async () => {
  const { document, warnings } = await composeArtifactDocument({
    html: ARTIFACT(`<link rel="stylesheet" href="https://cdn.example/x.css">`),
    path: "root/topic/artifact.html",
    files: filesFrom({}),
  });

  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /Remote stylesheet left unloaded: https:\/\/cdn\.example\/x\.css/u);
  assert.doesNotMatch(document, /<link\b/iu);
});

test("resolves a local image to the host preview URL and allows only that origin", async () => {
  const files = filesFrom({}, { previewUrl: (path) => `https://pi.example/preview?path=${path}` });
  const { document, images, warnings } = await composeArtifactDocument({
    html: ARTIFACT("", `<img src="./screenshot.png" alt=""><p>After</p>`),
    path: "root/topic/artifact.html",
    files,
  });

  assert.deepEqual(images, ["root/topic/screenshot.png"]);
  assert.deepEqual(warnings, []);
  assert.match(document, /src="https:\/\/pi\.example\/preview\?path=root\/topic\/screenshot\.png"/u);
  assert.match(document, /img-src data: blob: https:\/\/pi\.example/u);
  assert.match(document, /default-src 'none'/u);
});

test("reports a local image when the host cannot preview it", async () => {
  const { document, warnings } = await composeArtifactDocument({
    html: ARTIFACT("", `<img src="./screenshot.png" alt="">`),
    path: "root/topic/artifact.html",
    files: filesFrom({}),
  });

  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /Image left unloaded/u);
  assert.match(document, /src="\.\/screenshot\.png"/u);
});

test("the review document carries the annotation script", async () => {
  const { document } = await composeArtifactDocument({
    html: ARTIFACT(""),
    path: "root/topic/artifact.html",
    files: filesFrom({}),
  });

  assert.match(document, /data-review-hover/u);
  assert.match(document, /<script>/u);
  assert.doesNotMatch(document, /@page/u);
});

test("the print document has no review script, keeps the print rules and takes the title", async () => {
  const { document } = await composeArtifactDocument({
    html: ARTIFACT("<title>Original</title>"),
    path: "root/topic/artifact.html",
    files: filesFrom({}),
    forPrint: true,
    title: "Topic A",
  });

  assert.doesNotMatch(document, /data-review-hover/u);
  assert.doesNotMatch(document, /<script>/u);
  assert.match(document, /@page \{ margin: 0; \}/u);
  assert.match(document, /print-color-adjust: exact/u);
  assert.match(document, /animation: none !important/u);
  assert.match(document, /<title>Topic A<\/title>/u);
  assert.doesNotMatch(document, /<title>Original<\/title>/u);
});

test("a print title without a title element is inserted and escaped", async () => {
  const { document } = await composeArtifactDocument({
    html: ARTIFACT(""),
    path: "root/topic/artifact.html",
    files: filesFrom({}),
    forPrint: true,
    title: `A & B <C> "D"`,
  });

  assert.match(document, /<title>A &amp; B &lt;C&gt; &quot;D&quot;<\/title>/u);
  assert.equal((document.match(/<title>/gu) ?? []).length, 1);
});

test("the print stylesheet is appended after the artifact's own sheets", async () => {
  const { document } = await composeArtifactDocument({
    html: ARTIFACT(`<link rel="stylesheet" href="./artifact.css">`),
    path: "root/topic/artifact.html",
    files: filesFrom({ "root/topic/artifact.css": "body { color: red; }" }),
    forPrint: true,
  });

  assert.ok(document.indexOf("body { color: red; }") < document.indexOf("@page { margin: 0; }"));
});

test("feedbackText names each target and quotes a selection", () => {
  const text = feedbackText(
    [
      { kind: "element", tag: "h1", selector: "body > main > h1", comment: "Name the customer." },
      { kind: "text", tag: "p", selector: "body > p", excerpt: "Two sentences at most", comment: "One sentence." },
    ],
    "test-results/artifact/session/topic/artifact.html",
  );

  assert.equal(
    text,
    [
      "Review comments on test-results/artifact/session/topic/artifact.html",
      "",
      "1. <h1> body > main > h1",
      "   Name the customer.",
      '2. text in p "Two sentences at most"',
      "   One sentence.",
    ].join("\n"),
  );
});

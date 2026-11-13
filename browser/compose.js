/**
 * Compose the document that the review surface renders.
 *
 * The artifact is a normal HTML file on disk with a relative stylesheet beside it. It is rendered in an
 * iframe with `sandbox="allow-scripts"` and no `allow-same-origin`, so the page runs at an opaque origin:
 * it cannot read the host, its cookies or its DOM, and the Content-Security-Policy below blocks every
 * network request. Two consequences drive this module:
 *
 * 1. A relative `<link rel="stylesheet">` cannot be fetched from an opaque origin, so each local sheet is
 *    read through the workspace file API and inlined as a `<style>` block.
 * 2. A local `<img src>` cannot be fetched either. The host resolves it to a preview URL instead, and that
 *    origin is added to `img-src`, which is the one deliberate hole in the policy.
 *
 * Everything remote stays blocked on purpose. An artifact is expected to be self-contained.
 *
 * `forPrint` produces the same document for the browser's print pipeline instead of for review: no annotation
 * script, a print stylesheet, and a title that becomes the suggested PDF file name.
 */

export const MESSAGE_SOURCE = "artifact";

/** The review surface's own script, injected into the artifact after its content. */
const ANNOTATION_SCRIPT = String.raw`(function () {
  var HOVER = "data-review-hover";
  var on = true;
  var lastHover = null;

  var style = document.createElement("style");
  style.textContent = "[" + HOVER + "]{outline:2px solid #ff5d02 !important;outline-offset:2px !important;cursor:crosshair !important}";
  (document.head || document.documentElement).appendChild(style);

  function textOf(el) {
    var t = (el.textContent || "").replace(/\s+/g, " ").trim();
    return t.length > 160 ? t.slice(0, 157) + "..." : t;
  }

  function selectorFor(el) {
    var parts = [];
    var node = el;
    while (node && node.nodeType === 1 && node !== document.documentElement) {
      if (node.id) {
        parts.unshift("#" + node.id);
        break;
      }
      var tag = node.tagName.toLowerCase();
      var parent = node.parentElement;
      if (!parent) {
        parts.unshift(tag);
        break;
      }
      var sameTag = 0;
      var index = 0;
      for (var i = 0; i < parent.children.length; i++) {
        if (parent.children[i].tagName === node.tagName) {
          sameTag++;
          if (parent.children[i] === node) index = sameTag;
        }
      }
      parts.unshift(sameTag > 1 ? tag + ":nth-of-type(" + index + ")" : tag);
      node = parent;
    }
    return parts.join(" > ");
  }

  function post(payload) {
    payload.source = "artifact";
    try {
      parent.postMessage(payload, "*");
    } catch (error) {
      /* An opaque origin can always post to its parent; ignore the impossible case. */
    }
  }

  function clearHover() {
    if (lastHover && lastHover.removeAttribute) lastHover.removeAttribute(HOVER);
    lastHover = null;
  }

  document.addEventListener("mouseover", function (event) {
    if (!on || !(event.target instanceof Element)) return;
    var el = event.target;
    if (el === lastHover) return;
    clearHover();
    lastHover = el;
    el.setAttribute(HOVER, "");
  }, true);

  document.addEventListener("mouseout", function () {
    if (on) clearHover();
  }, true);

  document.addEventListener("click", function (event) {
    if (!on || !(event.target instanceof Element)) return;
    event.preventDefault();
    event.stopPropagation();
    clearHover();
    var el = event.target;
    var anchor = el.closest("a[href]");
    post({
      type: "pick",
      selector: selectorFor(el),
      tag: el.tagName.toLowerCase(),
      excerpt: textOf(el),
      link: anchor ? String(anchor.getAttribute("href") || "").slice(0, 200) : null
    });
  }, true);

  document.addEventListener("mouseup", function () {
    if (!on) return;
    var selection = window.getSelection();
    if (!selection || selection.isCollapsed) return;
    var text = String(selection.toString() || "").replace(/\s+/g, " ").trim();
    if (text.length < 2) return;
    var anchorNode = selection.anchorNode;
    var el = anchorNode && anchorNode.nodeType === 1 ? anchorNode : anchorNode && anchorNode.parentElement;
    post({
      type: "select",
      selector: el ? selectorFor(el) : "body",
      tag: el ? el.tagName.toLowerCase() : "body",
      excerpt: text.length > 300 ? text.slice(0, 297) + "..." : text
    });
  }, true);

  window.addEventListener("message", function (event) {
    var data = event.data;
    if (!data || data.source !== "artifact") return;
    if (data.type === "mode") {
      on = Boolean(data.annotate);
      if (!on) clearHover();
      return;
    }
    if (data.type === "scroll" && typeof data.selector === "string") {
      var target = null;
      try {
        target = document.querySelector(data.selector);
      } catch (error) {
        target = null;
      }
      if (target && target.scrollIntoView) target.scrollIntoView({ block: "center", behavior: "smooth" });
    }
  });

  post({ type: "ready", title: String(document.title || "") });
})();`;

function escapeScript(text) {
  return text.replace(/<\/script/giu, "<\\/script");
}

function escapeStyle(text) {
  return text.replace(/<\/style/giu, "<\\/style");
}

function escapeHtml(text) {
  return text.replace(/&/gu, "&amp;").replace(/</gu, "&lt;").replace(/>/gu, "&gt;").replace(/"/gu, "&quot;");
}

/** Insert markup at the end of the head, so a print style wins over the artifact's own sheets. */
function appendToHead(document, markup) {
  if (/<\/head>/iu.test(document)) return document.replace(/<\/head>/iu, `${markup}\n</head>`);
  if (/<head\b[^>]*>/iu.test(document)) return document.replace(/<head\b[^>]*>/iu, (match) => `${match}\n${markup}`);
  return `${markup}\n${document}`;
}

/**
 * Print rules. The page keeps its own padding as the page margin, the paper margin is zero so the artifact's
 * background reaches the edge, and colours print as designed instead of being dropped as decoration. Entrance
 * animations are switched off: the print copy is fresh, so an animated section could otherwise print at its
 * first, invisible frame.
 */
const PRINT_STYLE = `
@page { margin: 0; }
@media print {
  html { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  * { animation: none !important; transition: none !important; }
  h1, h2, h3, h4 { break-after: avoid-page; }
  tr, img, svg, pre, blockquote, figure, table, .card, .note, .diagram { break-inside: avoid; }
}
`;

/** Turn `./x.css` beside the artifact into a workspace-relative path, or undefined when it is not local. */
function localPathFor(reference, directory) {
  if (typeof reference !== "string") return undefined;
  const trimmed = reference.trim();
  if (trimmed === "" || trimmed.startsWith("#")) return undefined;
  if (/^(?:[a-z][a-z0-9+.-]*:|\/\/|\/)/iu.test(trimmed)) return undefined;
  const relative = trimmed.replace(/^\.\//u, "");
  return directory === "" ? relative : `${directory}/${relative}`;
}

function attributesOf(tag) {
  const attributes = new Map();
  const pattern = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*=\s*("[^"]*"|'[^']*'|[^\s"'>]+)/gu;
  let match = pattern.exec(tag);
  while (match !== null) {
    attributes.set(match[1].toLowerCase(), match[2].replace(/^["']|["']$/gu, ""));
    match = pattern.exec(tag);
  }
  return attributes;
}

function directoryOf(path) {
  const index = path.lastIndexOf("/");
  return index === -1 ? "" : path.slice(0, index);
}

/**
 * Build the srcdoc for one artifact.
 *
 * @param {object} input
 * @param {string} input.html the artifact source read from disk
 * @param {string} input.path the artifact's workspace-relative path
 * @param {{ readFile: (path: string) => Promise<{ content: string }>, previewUrl?: (path: string) => string }} files
 * @param {boolean} [input.forPrint] build the print copy rather than the review surface
 * @param {string} [input.title] document title for the print copy, which the print dialog suggests as a name
 * @returns {Promise<{ document: string, images: string[], sheets: string[], warnings: string[] }>}
 */
export async function composeArtifactDocument({ html, path, files, forPrint = false, title }) {
  const directory = directoryOf(path);
  const warnings = [];
  const images = [];
  const sheets = [];
  const imageOrigins = new Set();

  let document = String(html);

  const linkPattern = /<link\b[^>]*>/giu;
  const links = document.match(linkPattern) ?? [];
  for (const link of links) {
    const attributes = attributesOf(link);
    const rel = (attributes.get("rel") ?? "").toLowerCase();
    if (!rel.split(/\s+/u).includes("stylesheet")) continue;
    const assetPath = localPathFor(attributes.get("href"), directory);
    if (assetPath === undefined) {
      warnings.push(`Remote stylesheet left unloaded: ${attributes.get("href") ?? "unknown"}`);
      document = document.replace(link, "");
      continue;
    }
    try {
      const file = await files.readFile(assetPath);
      document = document.replace(link, `<style>\n${escapeStyle(file.content)}\n</style>`);
      sheets.push(assetPath);
    } catch (error) {
      warnings.push(`Stylesheet not readable: ${assetPath}`);
      document = document.replace(link, "");
    }
  }

  const imagePattern = /<img\b[^>]*>/giu;
  const imageTags = document.match(imagePattern) ?? [];
  for (const tag of imageTags) {
    const attributes = attributesOf(tag);
    const src = attributes.get("src");
    const assetPath = localPathFor(src, directory);
    if (assetPath === undefined) continue;
    if (typeof files.previewUrl !== "function") {
      warnings.push(`Image left unloaded: ${assetPath}`);
      continue;
    }
    const url = files.previewUrl(assetPath);
    try {
      imageOrigins.add(new URL(url, window.location.href).origin);
    } catch (error) {
      warnings.push(`Image URL not understood: ${assetPath}`);
      continue;
    }
    document = document.replace(tag, tag.replace(/\bsrc\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/iu, `src="${url}"`));
    images.push(assetPath);
  }

  const imageSources = ["data:", "blob:", ...imageOrigins].join(" ");
  const policy = [
    "default-src 'none'",
    "script-src 'unsafe-inline'",
    "style-src 'unsafe-inline'",
    "font-src data:",
    `img-src ${imageSources}`,
    "base-uri 'none'",
    "form-action 'none'",
  ].join("; ");
  const policyTag = `<meta http-equiv="Content-Security-Policy" content="${policy}">`;

  if (/<head\b[^>]*>/iu.test(document)) {
    document = document.replace(/<head\b[^>]*>/iu, (match) => `${match}\n${policyTag}`);
  } else {
    document = `${policyTag}\n${document}`;
  }

  if (forPrint) {
    // The print copy is only read by the print pipeline: it carries no review script and no hover styles.
    if (typeof title === "string" && title !== "") {
      const titleTag = `<title>${escapeHtml(title)}</title>`;
      document = /<title\b[^>]*>[\s\S]*?<\/title>/iu.test(document)
        ? document.replace(/<title\b[^>]*>[\s\S]*?<\/title>/iu, titleTag)
        : appendToHead(document, titleTag);
    }
    document = appendToHead(document, `<style>\n${PRINT_STYLE}</style>`);
    return { document, images, sheets, warnings };
  }

  const scriptTag = `<script>${escapeScript(ANNOTATION_SCRIPT)}</script>`;
  if (/<\/body>/iu.test(document)) {
    document = document.replace(/<\/body>/iu, `${scriptTag}\n</body>`);
  } else {
    document += `\n${scriptTag}`;
  }

  return { document, images, sheets, warnings };
}

/** The text one comment contributes to the chat message. */
export function feedbackText(comments, artifactPath) {
  const lines = [`Review comments on ${artifactPath}`, ""];
  comments.forEach((comment, index) => {
    const anchor = comment.kind === "text" ? `"${comment.excerpt}"` : `${comment.selector}`;
    const tag = comment.kind === "text" ? `text in ${comment.tag}` : `<${comment.tag}>`;
    lines.push(`${index + 1}. ${tag} ${anchor}`);
    lines.push(`   ${comment.comment}`);
  });
  return lines.join("\n");
}

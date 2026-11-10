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
 * @returns {Promise<{ document: string, images: string[], sheets: string[], warnings: string[] }>}
 */
export async function composeArtifactDocument({ html, path, files }) {
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

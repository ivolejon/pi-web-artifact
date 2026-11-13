import { composeArtifactDocument, feedbackText, MESSAGE_SOURCE } from "./compose.js";

/**
 * Where artifacts live: one directory per session, then one per topic. The session binding is what keeps a
 * workspace panel honest, because several conversations share a workspace and each has its own page.
 */
export const ARTIFACT_ROOT = "test-results/artifact";

export function sessionRoot(sessionId) {
  return `${ARTIFACT_ROOT}/${sessionId}`;
}

/** Cross-module signal: the host invalidated the workspace files, so the artifact list may have changed. */
export const reviewBus = new EventTarget();

const HTML_FILE = /\.html?$/iu;

/** Remembers whether the comments column is folded away, across pages, conversations and reloads. */
const COLLAPSED_KEY = "artifact:comments-collapsed:v1";

/** Points right when the column is expanded beside the artifact, down when it is stacked, up when folded. */
const CHEVRON = `<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" focusable="false"><path d="M6 3.5 10.5 8 6 12.5" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"></path></svg>`;

function isComment(value) {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof value.comment === "string" &&
    typeof value.selector === "string" &&
    typeof value.tag === "string" &&
    (value.kind === "element" || value.kind === "text")
  );
}

/** An open comment field: the target is chosen, the text is not written yet, so there is no `comment`. */
function isDraft(value) {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof value.selector === "string" &&
    typeof value.tag === "string" &&
    typeof value.excerpt === "string" &&
    (value.kind === "element" || value.kind === "text")
  );
}

function describeTarget(draft) {
  if (draft.kind === "text") return `Text in <${draft.tag}>: "${draft.excerpt}"`;
  return `<${draft.tag}> ${draft.selector}${draft.excerpt === "" ? "" : `: "${draft.excerpt}"`}`;
}

function formatWhen(value) {
  if (typeof value !== "string" || value === "") return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

function basename(path) {
  const index = path.lastIndexOf("/");
  return index === -1 ? path : path.slice(index + 1);
}

async function discoverArtifacts(files, sessionId, selectedPath) {
  const artifacts = [];
  const root = sessionRoot(sessionId);
  let top;
  try {
    top = await files.listFiles(ARTIFACT_ROOT);
  } catch (error) {
    // No artifact root yet: the workspace has never had one.
    return { artifacts, rootMissing: true };
  }
  const hasSessionDirectory = (top.entries ?? []).some((entry) => entry.type === "directory" && entry.name === sessionId);
  if (!hasSessionDirectory) return { artifacts, rootMissing: true };
  let listing;
  try {
    listing = await files.listFiles(root);
  } catch (error) {
    return { artifacts, rootMissing: true };
  }
  for (const entry of listing.entries ?? []) {
    if (entry.type !== "directory") continue;
    let inner;
    try {
      inner = await files.listFiles(entry.path);
    } catch (error) {
      continue;
    }
    for (const file of inner.entries ?? []) {
      if (file.type !== "file" || !HTML_FILE.test(file.name)) continue;
      artifacts.push({
        path: file.path,
        label: `${entry.name}/${file.name}`,
        slug: entry.name,
        name: file.name,
        modifiedAt: file.modifiedAt ?? "",
        size: file.size ?? 0,
      });
    }
  }
  artifacts.sort((a, b) => {
    const byTime = (b.modifiedAt ?? "").localeCompare(a.modifiedAt ?? "");
    if (byTime !== 0) return byTime;
    return a.label.localeCompare(b.label);
  });
  // A path from a stored deep link is honoured only while it belongs to this session.
  if (
    typeof selectedPath === "string" &&
    selectedPath.startsWith(`${root}/`) &&
    !artifacts.some((a) => a.path === selectedPath)
  ) {
    artifacts.unshift({ path: selectedPath, label: selectedPath.slice(root.length + 1), slug: basename(selectedPath), name: basename(selectedPath), modifiedAt: "", size: 0, outside: true });
  }
  return { artifacts, rootMissing: false };
}

const STYLE = `
  *, *::before, *::after { box-sizing: border-box; }
  :host { display: block; height: 100%; min-height: 0; }
  .wrap { display: flex; flex-direction: column; height: 100%; min-height: 0; background: var(--pi-bg); container-type: size; }
  .bar { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; padding: 8px 12px; border-bottom: 1px solid var(--pi-border); }
  .tabs { display: flex; flex: 1 1 0; gap: 4px; min-width: 180px; overflow-x: auto; scrollbar-width: thin; scrollbar-color: var(--pi-border) transparent; scroll-padding-inline: 4px; }
  .tabs button { flex: 0 0 auto; max-width: 32ch; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .tabs[hidden] { display: none; }
  /* A clipped tab should read as "the strip continues", not as a broken label. */
  .tabs[data-scrolled="true"] { mask-image: linear-gradient(to right, transparent 0, #000 18px, #000 100%); }
  .tabs[data-more="true"] { mask-image: linear-gradient(to right, #000 0, #000 calc(100% - 18px), transparent 100%); }
  .tabs[data-scrolled="true"][data-more="true"] { mask-image: linear-gradient(to right, transparent 0, #000 18px, #000 calc(100% - 18px), transparent 100%); }
  /* Row two holds the actions, so the bar reads the same at every panel width instead of leaving one
   * control stranded on its own line. */
  .bar-break { flex-basis: 100%; height: 0; }
  .bar .spacer { flex: 1 1 auto; }
  .annotate-toggle[aria-pressed="true"] { background: var(--pi-surface-hover); box-shadow: inset 0 0 0 1px var(--pi-accent); }
  .stage { display: grid; grid-template-columns: minmax(0, 1fr) 340px; grid-template-rows: minmax(0, 1fr); flex: 1 1 auto; min-height: 0; }
  .frame-holder { position: relative; min-width: 0; min-height: 0; background: #ffffff; }
  iframe { display: block; width: 100%; height: 100%; border: 0; background: #ffffff; }
  .notice { position: absolute; inset: 0; display: none; place-content: center; padding: 32px; text-align: center; background: var(--pi-bg); }
  .notice[data-visible="true"] { display: grid; }
  .notice h2 { margin: 0 0 8px; font-size: 16px; font-weight: 600; }
  .notice p { margin: 0; max-width: 52ch; color: var(--pi-muted); font-size: 13px; line-height: 1.5; }
  aside { display: flex; flex-direction: column; grid-column: 2; grid-row: 1; min-height: 0; border-left: 1px solid var(--pi-border); }
  /* Folded away, the column becomes a strip under the artifact: the header stays, the body goes, so the
   * control moves to the foot of the artifact instead of vanishing with the column. */
  .stage[data-collapsed="true"] { grid-template-columns: minmax(0, 1fr); grid-template-rows: minmax(0, 1fr) auto; }
  .stage[data-collapsed="true"] aside { grid-column: 1; grid-row: 2; border-left: 0; border-top: 1px solid var(--pi-border); }
  .aside-head { display: flex; align-items: center; gap: 8px; width: 100%; min-height: 38px; padding: 0 10px 0 12px; border: 0; border-bottom: 1px solid var(--pi-border); background: transparent; color: inherit; font: inherit; text-align: left; cursor: pointer; }
  .stage[data-collapsed="true"] .aside-head { border-bottom: 0; }
  .aside-head:hover { background: var(--pi-surface-hover); }
  .aside-head:focus-visible { outline: 2px solid var(--pi-accent); outline-offset: -2px; }
  .aside-head .label { font-size: 12px; font-weight: 600; }
  .aside-head .count { display: inline-grid; min-width: 18px; height: 18px; place-items: center; border-radius: 999px; background: var(--pi-accent); color: var(--pi-bg); padding: 0 5px; font-size: 10px; font-weight: 600; }
  .aside-head .count[hidden] { display: none; }
  .aside-head .chevron { display: grid; place-items: center; margin-left: auto; color: var(--pi-muted); transition: transform 120ms ease; }
  .aside-head:hover .chevron { color: inherit; }
  .stage[data-collapsed="true"] .aside-head .chevron { transform: rotate(-90deg); }
  .aside-body { display: flex; flex: 1 1 auto; flex-direction: column; min-height: 0; }
  .stage[data-collapsed="true"] .aside-body { display: none; }
  .draft { display: grid; gap: 8px; padding: 12px; border-bottom: 1px solid var(--pi-border); }
  .draft[hidden] { display: none; }
  .draft .target { margin: 0; font-family: var(--pi-mono); font-size: 11px; color: var(--pi-muted); overflow-wrap: anywhere; }
  .draft textarea { width: 100%; min-height: 64px; resize: vertical; padding: 8px 10px; border: 1px solid var(--pi-border); border-radius: 6px; background: var(--pi-surface); color: inherit; font: inherit; font-size: 13px; }
  .draft .row { display: flex; justify-content: flex-end; gap: 8px; }
  .comments { flex: 1 1 auto; min-height: 0; overflow-y: auto; display: grid; gap: 8px; align-content: start; margin: 0; padding: 10px 12px 16px; list-style: none; }
  .comment { display: grid; gap: 8px; border: 1px solid var(--pi-border); border-radius: 10px; background: var(--pi-surface); padding: 10px 12px; }
  .comment .head { display: flex; align-items: center; gap: 8px; min-width: 0; }
  .comment .index { display: grid; flex: 0 0 auto; place-items: center; width: 18px; height: 18px; border-radius: 999px; background: var(--pi-accent); color: var(--pi-bg); font-size: 10px; font-weight: 600; }
  .comment .target { display: flex; align-items: center; gap: 6px; min-width: 0; color: var(--pi-muted); font-family: var(--pi-mono); font-size: 11px; }
  .comment .tag { flex: 0 0 auto; border-radius: 4px; background: var(--pi-bg); padding: 0 4px; }
  .comment .selector { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .comment .text { margin: 0; font-size: 13px; line-height: 1.5; white-space: pre-wrap; overflow-wrap: anywhere; }
  .comment .actions { display: flex; gap: 6px; }
  .comment .actions button { min-height: 26px; border: 1px solid var(--pi-border); border-radius: 999px; background: transparent; padding: 0 10px; color: var(--pi-muted); font: inherit; font-size: 11px; cursor: pointer; }
  .comment .actions button:hover { border-color: var(--pi-muted); color: inherit; }
  .comment .actions button[data-action="remove"]:hover { border-color: var(--pi-danger); color: var(--pi-danger); }
  .hint { margin: 0; padding: 0 12px 16px; color: var(--pi-muted); font-size: 12px; line-height: 1.5; }
  .warn { margin: 0; padding: 8px 12px; border-bottom: 1px solid var(--pi-border); color: var(--pi-danger); font-size: 12px; }
  .warn[hidden] { display: none; }
  .info { margin: 0; padding: 8px 12px; border-bottom: 1px solid var(--pi-border); color: var(--pi-accent); font-size: 12px; }
  .info[hidden] { display: none; }
  button { font: inherit; }
  :host([data-plain]) button { padding: 5px 10px; border: 1px solid var(--pi-border); border-radius: 6px; background: var(--pi-surface); color: inherit; cursor: pointer; }
  :host([data-plain]) button[disabled] { opacity: .55; cursor: not-allowed; }
  :host([data-plain]) .primary { border-color: var(--pi-accent); }
  /* The sidebar and the chat both take width, so the panel is often far narrower than the window. A container
   * query reacts to the panel's own width; a media query would not. */
  @container (max-width: 860px) {
    /* Stacked: the comments take their content up to a share of the panel and then scroll. The cap is on the
     * list, in container units, because a percentage max-height on the aside would resolve against the row
     * it sits in, and a capped row would leave the panel with dead space when there is one comment. */
    .stage { grid-template-columns: minmax(0, 1fr); grid-template-rows: minmax(0, 1fr) auto; }
    .comments { max-height: 42cqh; }
    aside { grid-column: 1; grid-row: 2; border-left: 0; border-top: 1px solid var(--pi-border); }
    /* Stacked, the column lives below the artifact, so the fold points down. The folded strip is below
     * the artifact in both layouts, so its chevron keeps pointing up. */
    .aside-head .chevron { transform: rotate(90deg); }
    .stage[data-collapsed="true"] .aside-head .chevron { transform: rotate(-90deg); }
  }
`;

/**
 * The Review panel. One instance per open panel; the host passes its context as a property and the element
 * owns all state below it, so a re-render from the host never reloads the artifact.
 */
export class ArtifactPanel extends HTMLElement {
  #context;
  #stylesheetIntegration;
  #artifacts = [];
  #selectedPath;
  #comments = [];
  #draft;
  #annotate = true;
  #commentsCollapsed = false;
  #status = "idle";
  #message = "";
  #warnings = [];
  #counter = 0;
  #composing = 0;
  #loadToken = 0;
  #loadedKey;
  #loadedScope;
  #lastTabPath;
  #dom = {};
  #rootRegistered = false;

  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    const shadow = this.shadowRoot;
    const style = document.createElement("style");
    style.textContent = STYLE;

    const wrap = document.createElement("div");
    wrap.className = "wrap";

    const bar = document.createElement("div");
    bar.className = "bar";

    const tabs = document.createElement("div");
    tabs.className = "ui-tabs tabs";
    tabs.setAttribute("role", "tablist");
    tabs.setAttribute("aria-label", "Artifacts in this conversation");
    tabs.addEventListener("keydown", (event) => this.#onTabKey(event));
    tabs.addEventListener("scroll", () => this.#updateTabEdges());
    // A strip of pages reads better than a picker when one conversation has several of them.

    const refresh = document.createElement("button");
    refresh.type = "button";
    refresh.className = "ui-button ui-button--compact";
    refresh.textContent = "Refresh";
    refresh.addEventListener("click", () => {
      void this.#load();
    });

    const annotateButton = document.createElement("button");
    annotateButton.type = "button";
    annotateButton.className = "ui-button ui-button--compact annotate-toggle";
    annotateButton.textContent = "Annotate";
    annotateButton.title = "Click an element or select text to write a comment";
    annotateButton.addEventListener("click", () => this.#setAnnotate(!this.#annotate));

    const lineBreak = document.createElement("span");
    lineBreak.className = "bar-break";

    const spacer = document.createElement("span");
    spacer.className = "spacer";

    const send = document.createElement("button");
    send.type = "button";
    send.className = "ui-button ui-button--compact ui-button--primary primary";
    send.textContent = "Send to chat";
    send.addEventListener("click", () => this.#send());


    bar.append(tabs, refresh, lineBreak, annotateButton, spacer, send);

    const info = document.createElement("p");
    info.className = "info";
    info.hidden = true;
    const warn = document.createElement("p");
    warn.className = "warn";
    warn.hidden = true;

    const stage = document.createElement("div");
    stage.className = "stage";

    const holder = document.createElement("div");
    holder.className = "frame-holder";
    holder.id = "artifact-frame";
    const iframe = document.createElement("iframe");
    iframe.setAttribute("sandbox", "allow-scripts");
    iframe.setAttribute("referrerpolicy", "no-referrer");
    iframe.setAttribute("title", "Artifact under review");
    const notice = document.createElement("div");
    notice.className = "notice";
    const noticeTitle = document.createElement("h2");
    const noticeBody = document.createElement("p");
    notice.append(noticeTitle, noticeBody);
    holder.append(iframe, notice);

    const aside = document.createElement("aside");

    const asideHead = document.createElement("button");
    asideHead.type = "button";
    asideHead.className = "aside-head";
    asideHead.setAttribute("aria-controls", "artifact-comments");
    const asideLabel = document.createElement("span");
    asideLabel.className = "label";
    asideLabel.textContent = "Comments";
    const asideCount = document.createElement("span");
    asideCount.className = "count";
    asideCount.hidden = true;
    const chevron = document.createElement("span");
    chevron.className = "chevron";
    chevron.innerHTML = CHEVRON;
    asideHead.append(asideLabel, asideCount, chevron);
    asideHead.addEventListener("click", () => this.#setCollapsed(!this.#commentsCollapsed));

    const draft = document.createElement("form");
    draft.className = "draft";
    draft.hidden = true;
    const target = document.createElement("p");
    target.className = "target";
    const textarea = document.createElement("textarea");
    textarea.placeholder = "What should change here?";
    textarea.setAttribute("aria-label", "Comment");
    const draftRow = document.createElement("div");
    draftRow.className = "row";
    const cancel = document.createElement("button");
    cancel.type = "button";
    cancel.className = "ui-button ui-button--compact";
    cancel.textContent = "Cancel";
    cancel.addEventListener("click", () => this.#cancelDraft());
    const add = document.createElement("button");
    add.type = "submit";
    add.className = "ui-button ui-button--compact ui-button--primary primary";
    add.textContent = "Add comment";
    draftRow.append(cancel, add);
    draft.append(target, textarea, draftRow);
    draft.addEventListener("submit", (event) => {
      event.preventDefault();
      this.#commitDraft();
    });
    textarea.addEventListener("input", () => this.#persistComments());
    textarea.addEventListener("keydown", (event) => {
      if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault();
        this.#commitDraft();
      }
      if (event.key === "Escape") {
        event.preventDefault();
        this.#cancelDraft();
      }
    });

    const list = document.createElement("ul");
    list.className = "comments";
    list.setAttribute("aria-label", "Comments");

    const hint = document.createElement("p");
    hint.className = "hint";

    const asideBody = document.createElement("div");
    asideBody.className = "aside-body";
    asideBody.id = "artifact-comments";
    asideBody.append(draft, list, hint);
    aside.append(asideHead, asideBody);
    stage.append(holder, aside);
    wrap.append(bar, info, warn, stage);
    shadow.append(style, wrap);

    this.#dom = {
      tabs, refresh, annotateButton, send, info, warn, stage, asideHead, asideCount,
      iframe, notice, noticeTitle, noticeBody, draft, target, textarea, list, hint,
    };

    this.#commentsCollapsed = this.#readCollapsed();
    window.addEventListener("message", this.#onMessage);
    reviewBus.addEventListener("invalidate", this.#onInvalidate);
    this.#renderChrome();
  }

  set context(value) {
    const previous = this.#context;
    this.#context = value;
    const integration = this.#stylesheetIntegration;
    if (integration !== undefined && this.isConnected) {
      this.#registerRoot(integration);
    }
    const scopedChanged =
      previous?.workspace?.id !== value?.workspace?.id ||
      previous?.state?.selectedSession?.id !== value?.state?.selectedSession?.id;
    if (scopedChanged) {
      // Comments belong to one conversation's artifact; a different session starts clean.
      this.#comments = [];
      this.#cancelDraft();
      this.#selectedPath = this.#pathFromNavigation(value);
      this.#loadedKey = undefined;
      this.#loadedScope = undefined;
      void this.#load();
      return;
    }
    // The host re-renders freely; list once per scope unless something explicitly asks for a refresh.
    if (this.#loadedScope !== this.#scopeKey()) void this.#load();
    this.#renderChrome();
  }

  #scopeKey() {
    return `${this.#context?.workspace?.id ?? ""}|${this.#sessionId() ?? ""}`;
  }

  /** The conversation this panel is bound to, or undefined when none is selected. */
  #sessionId() {
    const id = this.#context?.state?.selectedSession?.id;
    return typeof id === "string" && id !== "" ? id : undefined;
  }

  set stylesheetIntegration(value) {
    this.#stylesheetIntegration = value;
    if (value !== undefined && this.isConnected) this.#registerRoot(value);
    else if (value === undefined) {
      this.dataset.plain = "true";
    }
  }

  connectedCallback() {
    this.#startWatching();
    if (this.#stylesheetIntegration !== undefined) this.#registerRoot(this.#stylesheetIntegration);
    else {
      this.dataset.plain = "true";
    }
    if (this.#context !== undefined && this.#loadedScope !== this.#scopeKey()) void this.#load();
  }

  disconnectedCallback() {
    window.removeEventListener("message", this.#onMessage);
    reviewBus.removeEventListener("invalidate", this.#onInvalidate);
    this.#stopWatching();
  }

  /**
   * The host's invalidation does not report every write that lands on disk, for example a file the agent
   * saves from a terminal, so the panel also compares the artifact's modification time itself. Two seconds
   * is fast enough to feel live and cheap enough to leave running: the check lists one directory and reads
   * the file only when it changed.
   */
  #startWatching() {
    if (this.#watchTimer !== undefined) return;
    this.#watchTimer = setInterval(() => {
      if (document.hidden === true) return;
      void this.#checkForChange();
    }, 2000);
  }

  #stopWatching() {
    if (this.#watchTimer === undefined) return;
    clearInterval(this.#watchTimer);
    this.#watchTimer = undefined;
  }

  async #checkForChange() {
    const files = this.#files();
    const path = this.#selectedPath;
    // An error state retries too: a file written in several steps can be unreadable for one check.
    if (files === undefined || path === undefined) return;
    if (this.#status !== "ready" && this.#status !== "error") return;
    const slash = path.lastIndexOf("/");
    const directory = slash === -1 ? "" : path.slice(0, slash);
    let listing;
    try {
      listing = await files.listFiles(directory);
    } catch (error) {
      return;
    }
    const entry = (listing.entries ?? []).find((candidate) => candidate.path === path);
    if (entry === undefined) return;
    const key = `${path}|${entry.modifiedAt ?? ""}|${entry.size ?? 0}`;
    if (key === this.#loadedKey) return;
    await this.#load();
  }

  /** Called by the plugin's panel invalidation hook. */
  invalidate() {
    void this.#load();
  }

  #registerRoot(integration) {
    if (typeof integration?.registerRoot !== "function") return;
    if (this.#rootRegistered === true) return;
    try {
      integration.registerRoot(this.shadowRoot, { sharedUi: true });
      this.#rootRegistered = true;
    } catch (error) {
      this.dataset.plain = "true";
    }
  }

  #pathFromNavigation(context) {
    const query = context?.navigation?.query;
    const value = query?.path;
    if (typeof value === "string" && value !== "") return value;
    if (Array.isArray(value) && typeof value[0] === "string" && value[0] !== "") return value[0];
    return undefined;
  }

  #files() {
    return this.#context?.files;
  }

  /**
   * Comments belong to one page in one conversation, and the host unmounts the panel whenever another tool tab
   * is selected. They live in sessionStorage so a tab switch, a reload or a live revision does not throw
   * away what the user has written. The key carries both the session and the page.
   */
  #commentsKey() {
    const sessionId = this.#sessionId();
    if (sessionId === undefined || this.#selectedPath === undefined) return undefined;
    return `artifact:${sessionId}:${this.#selectedPath}`;
  }

  #storage() {
    try {
      return window.sessionStorage;
    } catch (error) {
      return undefined;
    }
  }

  #persistComments() {
    const key = this.#commentsKey();
    const storage = this.#storage();
    if (key === undefined || storage === undefined) return;
    const draft = this.#draft;
    const draftText = this.#dom.textarea?.value ?? "";
    try {
      if (this.#comments.length === 0 && draft === undefined) {
        storage.removeItem(key);
        return;
      }
      storage.setItem(key, JSON.stringify({ comments: this.#comments, draft: draft ?? null, draftText }));
    } catch (error) {
      /* A full or blocked storage leaves the comments in memory only. */
    }
  }

  #restoreComments() {
    const key = this.#commentsKey();
    const storage = this.#storage();
    if (key === undefined || storage === undefined) return;
    let parsed;
    try {
      const raw = storage.getItem(key);
      if (raw === null) return;
      parsed = JSON.parse(raw);
    } catch (error) {
      return;
    }
    // Payloads written before the rename stored the list under `notes`.
    const stored = Array.isArray(parsed?.comments) ? parsed.comments : Array.isArray(parsed?.notes) ? parsed.notes : [];
    this.#comments = stored.filter(isComment);
    const draft = isDraft(parsed?.draft) ? parsed.draft : undefined;
    const draftText = typeof parsed?.draftText === "string" ? parsed.draftText : "";
    if (draft === undefined) {
      this.#dom.draft.hidden = true;
    } else {
      this.#draft = draft;
      // A restored draft is a comment field in progress; never leave it folded out of sight.
      if (this.#commentsCollapsed) this.#setCollapsed(false);
      this.#dom.draft.hidden = false;
      this.#dom.target.textContent = describeTarget(draft);
      this.#dom.textarea.value = draftText;
    }
    this.#updateComments();
  }

  #onInvalidate = () => {
    // Agent activity fires often; coalesce bursts so a scan is not run per event.
    if (this.#invalidateTimer !== undefined) return;
    this.#invalidateTimer = setTimeout(() => {
      this.#invalidateTimer = undefined;
      void this.#load();
    }, 200);
  };

  #invalidateTimer;
  #watchTimer;

  async #load() {
    const files = this.#files();
    if (files === undefined) return;
    // A scan takes several awaits. If the user picks a tab while it runs, that choice wins: bumping the
    // token makes the older scan drop its result instead of selecting over the click.
    const token = ++this.#loadToken;
    this.#loadedScope = this.#scopeKey();
    const sessionId = this.#sessionId();
    if (sessionId === undefined) {
      this.#artifacts = [];
      this.#selectedPath = undefined;
      this.#loadedKey = undefined;
      this.#status = "nosession";
      this.#message = "";
      this.#renderChrome();
      this.#updateStage();
      return;
    }
    const previous = this.#selectedPath;
    const { artifacts, rootMissing } = await discoverArtifacts(files, sessionId, previous);
    if (token !== this.#loadToken) return;
    this.#artifacts = artifacts;
    if (artifacts.length === 0) {
      this.#selectedPath = undefined;
      this.#loadedKey = undefined;
      this.#status = "empty";
      this.#message = rootMissing
        ? `No ${sessionRoot(sessionId)} directory yet. Ask this conversation for a visual review and the agent writes the artifact there.`
        : `This conversation has no artifact yet. Ask it for a visual review, then press Refresh.`;
      this.#renderChrome();
      this.#updateStage();
      return;
    }
    const keep = previous !== undefined && artifacts.some((a) => a.path === previous) ? previous : artifacts[0].path;
    // A rescan runs on every agent-activity invalidation, so it must be cheap and must never disturb a
    // review in progress: an unchanged file keeps its comments, and an open draft stays open.
    const artifact = artifacts.find((candidate) => candidate.path === keep);
    const key = `${keep}|${artifact?.modifiedAt ?? ""}|${artifact?.size ?? 0}`;
    if (keep === previous && key === this.#loadedKey && this.#status === "ready") {
      this.#renderChrome();
      return;
    }
    await this.#select(keep, { keepComments: keep === previous, fromLoad: true });
  }

  async #select(path, options = {}) {
    if (typeof path !== "string" || path === "") return;
    const files = this.#files();
    if (files === undefined) return;
    this.#loadToken += 1;
    const samePath = path === this.#selectedPath;
    if (!samePath && options.keepComments !== true) {
      // Close out the page we are leaving before the key changes, so its comments are stored under its own
      // path rather than under the new one.
      this.#persistComments();
      this.#comments = [];
      this.#draft = undefined;
      this.#dom.draft.hidden = true;
      this.#dom.textarea.value = "";
    }
    this.#selectedPath = path;
    this.#status = "loading";
    this.#message = "";
    this.#restoreComments();
    this.#renderChrome();
    if (options.fromLoad !== true && this.#context?.navigation !== undefined) {
      try {
        this.#context.navigation.set("path", path, { replace: true });
      } catch (error) {
        /* Deep linking is optional; the panel still works without it. */
      }
    }
    const generation = ++this.#composing;
    let file;
    try {
      file = await files.readFile(path);
    } catch (error) {
      if (generation !== this.#composing) return;
      this.#status = "error";
      this.#message = `The artifact could not be read: ${String(error?.message ?? error)}`;
      this.#renderChrome();
      this.#updateStage();
      return;
    }
    let composed;
    try {
      composed = await composeArtifactDocument({ html: file.content, path, files });
    } catch (error) {
      if (generation !== this.#composing) return;
      this.#status = "error";
      this.#message = `The artifact could not be prepared: ${String(error?.message ?? error)}`;
      this.#renderChrome();
      this.#updateStage();
      return;
    }
    if (generation !== this.#composing) return;
    this.#warnings = [
      ...(file.truncated === true ? ["The file is larger than the surface reads, so it is shown truncated."] : []),
      ...composed.warnings,
    ];
    this.#loadedKey = `${path}|${file.modifiedAt ?? ""}|${file.size ?? 0}`;
    this.#status = "ready";
    this.#dom.iframe.srcdoc = composed.document;
    this.#renderChrome();
    this.#updateStage();
    this.#postMode();
  }

  #selected() {
    return this.#artifacts.find((artifact) => artifact.path === this.#selectedPath);
  }

  #setAnnotate(value) {
    this.#annotate = value;
    this.#renderChrome();
    this.#postMode();
  }

  /**
   * The fold is a preference, not page state: it is kept in localStorage so it survives a reload, another
   * artifact and another conversation. The host unmounts the panel on a tab switch, which is why it cannot
   * live in the element alone.
   */
  #readCollapsed() {
    try {
      return window.localStorage.getItem(COLLAPSED_KEY) === "true";
    } catch (error) {
      return false;
    }
  }

  #persistCollapsed() {
    try {
      window.localStorage.setItem(COLLAPSED_KEY, this.#commentsCollapsed ? "true" : "false");
    } catch (error) {
      /* A full or blocked storage leaves the fold for this page only. */
    }
  }

  #setCollapsed(value) {
    const collapsed = value === true;
    if (collapsed === this.#commentsCollapsed) return;
    this.#commentsCollapsed = collapsed;
    this.#persistCollapsed();
    this.#renderCollapsed();
  }

  #renderCollapsed() {
    const dom = this.#dom;
    if (dom.asideHead === undefined) return;
    dom.stage.dataset.collapsed = this.#commentsCollapsed ? "true" : "false";
    dom.asideHead.setAttribute("aria-expanded", this.#commentsCollapsed ? "false" : "true");
    dom.asideHead.title = this.#commentsCollapsed ? "Show the comments" : "Hide the comments";
  }

  #postMode() {
    const frame = this.#dom.iframe;
    if (frame.contentWindow === null) return;
    try {
      frame.contentWindow.postMessage({ source: MESSAGE_SOURCE, type: "mode", annotate: this.#annotate }, "*");
    } catch (error) {
      /* The frame may be navigating; the script re-announces itself on load. */
    }
  }

  #onMessage = (event) => {
    const frame = this.#dom.iframe;
    if (event.source !== frame?.contentWindow) return;
    const data = event.data;
    if (data === null || typeof data !== "object" || data.source !== MESSAGE_SOURCE) return;
    if (data.type === "ready") {
      this.#postMode();
      return;
    }
    if (data.type !== "pick" && data.type !== "select") return;
    const excerpt = typeof data.excerpt === "string" ? data.excerpt.slice(0, 320) : "";
    const selector = typeof data.selector === "string" ? data.selector.slice(0, 300) : "body";
    const tag = typeof data.tag === "string" ? data.tag.slice(0, 40) : "element";
    this.#draft = {
      kind: data.type === "select" ? "text" : "element",
      selector,
      tag,
      excerpt,
      link: typeof data.link === "string" ? data.link.slice(0, 200) : undefined,
    };
    // A pick lands in the comment field, so the field has to be on screen even when the column was folded.
    if (this.#commentsCollapsed) this.#setCollapsed(false);
    const draft = this.#dom.draft;
    draft.hidden = false;
    this.#dom.target.textContent = describeTarget(this.#draft);
    this.#dom.textarea.value = "";
    this.#dom.textarea.focus();
    this.#updateComments();
    this.#persistComments();
  };

  #cancelDraft() {
    this.#draft = undefined;
    this.#dom.draft.hidden = true;
    this.#dom.textarea.value = "";
    this.#updateComments();
    this.#persistComments();
  }

  #commitDraft() {
    const comment = this.#dom.textarea.value.trim();
    if (this.#draft === undefined || comment === "") return;
    this.#counter += 1;
    this.#comments = [
      ...this.#comments,
      { id: `comment-${Date.now()}-${this.#counter}`, ...this.#draft, comment },
    ];
    this.#cancelDraft();
    this.#renderChrome();
    this.#persistComments();
  }

  #removeComment(id) {
    this.#comments = this.#comments.filter((comment) => comment.id !== id);
    this.#renderChrome();
    this.#persistComments();
  }

  #send() {
    if (this.#comments.length === 0 || this.#selectedPath === undefined) return;
    const text = feedbackText(this.#comments, this.#selectedPath);
    const prompt = this.#context?.prompt;
    const artifact = this.#selected();
    try {
      if (typeof prompt?.setChip === "function") {
        prompt.setChip({
          id: `artifact:${this.#selectedPath}`,
          label: `Artifact: ${artifact?.slug ?? "review"}`,
          text,
          onRemove: (reason) => {
            if (reason === "submitted") {
              this.#comments = [];
              this.#renderChrome();
              this.#persistComments();
            }
          },
        });
        this.#message = "Added to the message box. Press Send in the chat to deliver it.";
        this.#renderChrome();
        return;
      }
    } catch (error) {
      /* Fall through to the composer and clipboard below. */
    }
    try {
      if (typeof prompt?.insertText === "function") {
        prompt.insertText(`${prompt.getText() ?? ""}${text}`);
        this.#message = "Written into the message box. Press Send in the chat to deliver it.";
        this.#renderChrome();
        return;
      }
    } catch (error) {
      /* Fall through to the clipboard. */
    }
    void navigator.clipboard?.writeText(text).then(
      () => {
        this.#message = "Copied to the clipboard. Paste it into the chat.";
        this.#renderChrome();
      },
      () => {
        this.#message = "Could not reach the chat. Select the comments and copy them manually.";
        this.#renderChrome();
      },
    );
  }

  #renderChrome() {
    const dom = this.#dom;
    if (dom.tabs === undefined) return;
    const artifacts = this.#artifacts;
    const current = this.#selectedPath;

    const scrollLeft = dom.tabs.scrollLeft;
    const selectionChanged = current !== this.#lastTabPath;
    this.#lastTabPath = current;
    dom.tabs.replaceChildren();
    dom.tabs.hidden = artifacts.length === 0;
    const slugCounts = new Map();
    for (const artifact of artifacts) slugCounts.set(artifact.slug, (slugCounts.get(artifact.slug) ?? 0) + 1);
    for (const artifact of artifacts) {
      const selected = artifact.path === current;
      const tab = document.createElement("button");
      tab.type = "button";
      tab.className = "ui-button ui-button--compact ui-tab";
      tab.setAttribute("role", "tab");
      tab.setAttribute("aria-selected", selected ? "true" : "false");
      tab.setAttribute("aria-controls", "artifact-frame");
      tab.tabIndex = selected ? 0 : -1;
      if (selected) tab.classList.add("selected");
      tab.dataset.path = artifact.path;
      const when = formatWhen(artifact.modifiedAt);
      tab.title = `${artifact.path}${when === "" ? "" : ` · ${when}`}`;
      // The topic is enough when it is unique; a second page in the same topic keeps a short file name.
      tab.textContent = (slugCounts.get(artifact.slug) ?? 0) > 1
        ? `${artifact.slug} · ${artifact.name.replace(/\.html?$/iu, "").replace(/^artifact[-.]?/u, "") || "artifact"}`
        : artifact.slug;
      tab.addEventListener("click", () => {
        void this.#select(artifact.path);
      });
      dom.tabs.append(tab);
    }
    dom.tabs.scrollLeft = selectionChanged ? 0 : scrollLeft;
    if (selectionChanged) {
      // Put the selected tab at the left edge of the strip, so a long strip never starts mid-word.
      const selectedTab = dom.tabs.querySelector('[role="tab"][aria-selected="true"]');
      if (selectedTab !== null) selectedTab.scrollIntoView({ inline: "start", block: "nearest" });
    }
    this.#updateTabEdges();

    dom.annotateButton.setAttribute("aria-pressed", this.#annotate ? "true" : "false");
    dom.annotateButton.title = this.#annotate
      ? "Annotating: click an element or select text to write a comment"
      : "Browsing: clicks stay inside the page. Turn this on to annotate";
    dom.asideCount.hidden = this.#comments.length === 0;
    dom.asideCount.textContent = String(this.#comments.length);
    dom.asideCount.title = `${this.#comments.length} ${this.#comments.length === 1 ? "comment" : "comments"}`;
    this.#renderCollapsed();
    dom.send.disabled = this.#comments.length === 0 || this.#selectedPath === undefined;
    dom.refresh.disabled = this.#status === "loading";

    dom.warn.hidden = this.#warnings.length === 0;
    dom.warn.textContent = this.#warnings.join(" ");
    dom.info.hidden = this.#message === "";
    dom.info.textContent = this.#message;
    this.#updateComments();
  }

  /** Marks the edges of a strip that scrolls, so a clipped tab reads as an invitation to scroll. */
  #updateTabEdges() {
    const tabs = this.#dom.tabs;
    if (tabs === undefined) return;
    tabs.dataset.scrolled = tabs.scrollLeft > 0 ? "true" : "false";
    tabs.dataset.more = tabs.scrollLeft + tabs.clientWidth < tabs.scrollWidth - 1 ? "true" : "false";
  }

  /** Arrow keys move between artifact tabs, as a tab strip should. */
  #onTabKey(event) {
    const keys = ["ArrowLeft", "ArrowRight", "Home", "End"];
    if (!keys.includes(event.key)) return;
    const tabs = [...this.#dom.tabs.querySelectorAll('[role="tab"]')];
    if (tabs.length === 0) return;
    event.preventDefault();
    const index = tabs.findIndex((tab) => tab.getAttribute("aria-selected") === "true");
    const next = event.key === "Home"
      ? 0
      : event.key === "End"
        ? tabs.length - 1
        : (index + (event.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length;
    const target = tabs[next];
    if (target === undefined) return;
    void this.#select(target.dataset.path).then(() => {
      this.#dom.tabs.querySelector(`[data-path="${CSS.escape(target.dataset.path)}"]`)?.focus();
    });
  }

  #updateComments() {
    const dom = this.#dom;
    if (dom.list === undefined) return;
    dom.list.replaceChildren();
    this.#comments.forEach((comment, index) => {
      const item = document.createElement("li");
      item.className = "comment";

      const head = document.createElement("div");
      head.className = "head";
      const badge = document.createElement("span");
      badge.className = "index";
      badge.textContent = String(index + 1);
      const target = document.createElement("span");
      target.className = "target";
      const tag = document.createElement("span");
      tag.className = "tag";
      tag.textContent = comment.kind === "text" ? `text in ${comment.tag}` : `<${comment.tag}>`;
      const selector = document.createElement("span");
      selector.className = "selector";
      selector.textContent = comment.kind === "text" ? `"${comment.excerpt}"` : comment.selector;
      selector.title = comment.kind === "text"
        ? `${comment.selector}\n"${comment.excerpt}"`
        : comment.selector;
      target.append(tag, selector);
      head.append(badge, target);

      const text = document.createElement("p");
      text.className = "text";
      text.textContent = comment.comment;

      const actions = document.createElement("div");
      actions.className = "actions";
      const show = document.createElement("button");
      show.type = "button";
      show.textContent = "Show";
      show.title = "Scroll the page to this target";
      show.addEventListener("click", () => {
        try {
          this.#dom.iframe.contentWindow?.postMessage(
            { source: MESSAGE_SOURCE, type: "scroll", selector: comment.selector },
            "*",
          );
        } catch (error) {
          /* Nothing to scroll to when the frame is not ready. */
        }
      });
      const remove = document.createElement("button");
      remove.type = "button";
      remove.dataset.action = "remove";
      remove.textContent = "Remove";
      remove.addEventListener("click", () => this.#removeComment(comment.id));
      actions.append(show, remove);

      item.append(head, text, actions);
      dom.list.append(item);
    });
    dom.hint.textContent = this.#comments.length === 0
      ? "Click an element, or select text, in the artifact. Then write what should change and press Add comment."
      : "Send the comments to the chat, or keep annotating.";
  }

  #updateStage() {
    const dom = this.#dom;
    if (dom.notice === undefined) return;
    const ready = this.#status === "ready";
    dom.notice.dataset.visible = ready ? "false" : "true";
    if (ready) return;
    if (this.#status === "loading") {
      dom.noticeTitle.textContent = "Opening the artifact";
      dom.noticeBody.textContent = "Reading the file and preparing it for review.";
      return;
    }
    if (this.#status === "error") {
      dom.noticeTitle.textContent = "The artifact could not be shown";
      dom.noticeBody.textContent = this.#message;
      return;
    }
    if (this.#status === "nosession") {
      dom.noticeTitle.textContent = "No conversation selected";
      dom.noticeBody.textContent = "The tab shows the artifact belonging to the open conversation. Select one, and its page appears here.";
      return;
    }
    dom.noticeTitle.textContent = "Nothing to review yet";
    dom.noticeBody.textContent = this.#message === ""
      ? "Ask the open conversation for a visual review. It writes the artifact under its own session directory."
      : this.#message;
  }
}

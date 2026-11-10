import { ARTIFACT_ROOT, sessionRoot } from "./review-panel.js";

/**
 * Open the Artifact tab when a new page appears for the conversation the user is looking at.
 *
 * The plugin API gives a browser plugin no context while its own tab is closed, so this module leans on two
 * host facts that are stable in practice but are not part of the plugin contract. Both are marked below.
 * If either changes, the artifact is still one click away and nothing else breaks.
 *
 * 1. A workspace label contribution renders in every workspace view, including the chat, so its render
 *    callback is where the latest context is captured. Its file handle can point at another workspace, so
 *    it is used for the machine id only; the listing goes through the host's own tree route, with the
 *    project, workspace and session taken from the URL the user is looking at.
 * 2. There is no API for selecting a tool from a closed panel. The selection lives in the URL as
 *    `tool=<plugin>:<contribution>&view=workspace`, and the client follows history navigation, so the switch
 *    writes that URL and dispatches `popstate`.
 */

const INTERVAL_MS = 1500;
const HTML_FILE = /\.html?$/iu;
const ARTIFACT_TOOL = "workspace.artifact";

let context;
let runtimePluginId;
let timer;
let seeded = false;
const opened = new Set();

/** Called from the label's render callback. Stores the context and starts one watcher. */
export function watchWorkspace(contextValue) {
  context = contextValue;
  if (timer !== undefined) return;
  timer = setInterval(() => {
    void tick();
  }, INTERVAL_MS);
}

export function configureAutoOpen(pluginRuntimeId) {
  runtimePluginId = pluginRuntimeId;
}

function routeScope() {
  if (typeof window === "undefined" || window.location === undefined) return undefined;
  const params = new URLSearchParams(window.location.search);
  const project = params.get("project");
  const workspace = params.get("workspace");
  const session = params.get("session");
  if (project === null || workspace === null || session === null || session === "") return undefined;
  const machine = context?.state?.selectedMachine?.id ?? "local";
  return { params, project, workspace, session, machine };
}

/** The host's tree route, relative so a nested deployment prefix keeps working. */
async function listDirectory(scope, path) {
  const url =
    `api/machines/${encodeURIComponent(scope.machine)}/projects/${encodeURIComponent(scope.project)}` +
    `/workspaces/${encodeURIComponent(scope.workspace)}/tree?path=${encodeURIComponent(path)}`;
  const response = await fetch(url, { headers: { accept: "application/json" }, credentials: "same-origin" });
  if (!response.ok) throw new Error(`tree ${String(response.status)}`);
  return response.json();
}

async function tick() {
  if (runtimePluginId === undefined) return;
  if (document.hidden === true) return;
  const scope = routeScope();
  if (scope === undefined) return;

  let topics;
  try {
    topics = await listDirectory(scope, sessionRoot(scope.session));
  } catch (error) {
    // No directory yet for this conversation: there is nothing to open.
    seeded = true;
    return;
  }

  const pages = [];
  for (const topic of topics.entries ?? []) {
    if (topic.type !== "directory") continue;
    let inner;
    try {
      inner = await listDirectory(scope, topic.path);
    } catch (error) {
      continue;
    }
    for (const file of inner.entries ?? []) {
      if (file.type !== "file" || !HTML_FILE.test(file.name)) continue;
      pages.push(file.path);
    }
  }

  // The first pass records what already exists, so loading the app never steals the tab.
  if (!seeded) {
    for (const page of pages) opened.add(page);
    seeded = true;
    return;
  }

  for (const page of pages) {
    if (opened.has(page)) continue;
    opened.add(page);
    selectTool(scope);
    return;
  }
}

function selectTool(scope) {
  const toolId = `${runtimePluginId}:${ARTIFACT_TOOL}`;
  const url = new URL(window.location.href);
  if (url.searchParams.get("tool") === toolId) return;
  url.searchParams.set("tool", toolId);
  url.searchParams.set("view", "workspace");
  // Drop a stored artifact selection so the panel shows the new page rather than the last one reviewed.
  for (const [key, value] of [...url.searchParams]) {
    if (value.startsWith(`${ARTIFACT_ROOT}/`)) url.searchParams.delete(key);
  }
  try {
    window.history.pushState({}, "", `${url.pathname}${url.search}${url.hash}`);
    window.dispatchEvent(new PopStateEvent("popstate", { state: {} }));
  } catch (error) {
    /* A refused history write leaves the user where they were; the page is one click away. */
  }
}

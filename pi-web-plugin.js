import { ArtifactPanel, reviewBus, sessionRoot } from "./review-panel.js";
import { configureAutoOpen, watchWorkspace } from "./auto-open.js";

/**
 * The Review tab: render a review artifact from the workspace in a sandbox, let the user annotate
 * elements and text, and hand the comments to the chat as a message-box chip.
 *
 * Browser-only on purpose. It reads workspace files through the host's file capability, so it needs no
 * server entry, no port, and no session-daemon restart.
 */

const stylesheetIntegrationCapability = {
  pluginId: "pi-web",
  id: "stylesheet-integration",
  version: 1,
  parse(value) {
    if (
      typeof value !== "object" ||
      value === null ||
      typeof value.registerRoot !== "function" ||
      typeof value.createController !== "function" ||
      typeof value.subscribe !== "function"
    ) {
      throw new Error("Stylesheet integration v1 requires registerRoot, createController and subscribe");
    }
    return value;
  },
};

function definePanelElement() {
  const name = "artifact-panel";
  if (customElements.get(name) === undefined) customElements.define(name, ArtifactPanel);
}

const plugin = {
  apiVersion: 5,
  name: "Artifact review",
  requires: [stylesheetIntegrationCapability],
  activate: ({ html, svg, runtimePluginId }) => {
    definePanelElement();
    configureAutoOpen(runtimePluginId);
    let stylesheetIntegration;
    return {
      start({ capabilities }) {
        try {
          stylesheetIntegration = capabilities.resolve(stylesheetIntegrationCapability);
        } catch (error) {
          stylesheetIntegration = undefined;
        }
      },
      contributions: {
        actions: [
          {
            id: "artifact.open",
            title: "Open artifact",
            description: "Open the Artifact tab and show this workspace's latest artifact",
            group: "Workspace",
            enabled: (context) => context.state?.selectedWorkspace !== undefined,
            disabledReason: () => "Select a workspace first",
            run: (context) => {
              if (context.state?.selectedWorkspace === undefined) return;
              context.selectWorkspaceTool(`${runtimePluginId}:workspace.artifact`);
            },
          },
        ],
        workspaceLabels: [
          {
            // Renders nothing. It exists because a label's context is the only one the host provides while
            // another tool tab is selected, and the auto-open watcher needs that context.
            id: "artifact.context",
            order: 900,
            items: (context) => {
              watchWorkspace(context);
              return [];
            },
          },
        ],
        workspacePanels: [
          {
            id: "workspace.artifact",
            title: "Artifact",
            icon: svg`
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <rect x="3" y="4" width="18" height="16" rx="2"></rect>
                <path d="M7 9h10"></path>
                <path d="M7 13h6"></path>
                <path d="M14.5 16.5 17 19l3-3.5"></path>
              </svg>
            `,
            order: 45,
            invalidationResources: ["workspace.files"],
            fileOpenQuery: (context, path) => {
              // Claim a link only when it points at an artifact of the conversation the link is in.
              const sessionId = context.state?.selectedSession?.id;
              if (typeof sessionId !== "string" || typeof path !== "string") return undefined;
              if (!path.startsWith(`${sessionRoot(sessionId)}/`) || !/\.html?$/iu.test(path)) return undefined;
              return { path };
            },
            onInvalidate: () => {
              reviewBus.dispatchEvent(new Event("invalidate"));
            },
            render: (context) =>
              // Property bindings update the existing element on every host re-render, so the artifact keeps
              // its scroll position and the panel keeps its comments.
              html`<artifact-panel .context=${context} .stylesheetIntegration=${stylesheetIntegration}></artifact-panel>`,
          },
        ],
      },
    };
  },
};

export default plugin;

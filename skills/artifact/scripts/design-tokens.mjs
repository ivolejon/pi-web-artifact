#!/usr/bin/env node
/**
 * Build the token sheet for one review artifact from the design source of the repository it describes.
 *
 * The artifact cannot link the project's stylesheet: it renders in a sandbox that blocks every network
 * request and runs at an opaque origin. So the palette, the type and the radii are copied into one small
 * sheet that travels with the page, and the page's own structure sheet (`artifact.css`) reads them through
 * a fixed set of semantic names.
 *
 * Usage, from the repository root:
 *
 *   node design-tokens.mjs --out <run>/tokens.css [--css <file>]... [--root <dir>] [--json]
 *
 * No `--css` means discovery: named stylesheets first, then any stylesheet that declares custom properties,
 * skipping build output and dependencies. `--json` prints what was found, what was mapped and what fell back.
 *
 * Exit codes: 0 wrote a sheet from a source, 3 found no design source, 1 bad input.
 */

import { readFile, writeFile, readdir, stat } from "node:fs/promises";
import { dirname, join, relative, resolve, extname, basename } from "node:path";

const SKIP_DIRECTORIES = new Set([
  "node_modules", ".git", ".next", ".nuxt", ".svelte-kit", ".turbo", ".cache", "dist", "build", "out",
  "coverage", "test-results", "vendor", "target", "bin", "obj", ".venv", "venv", "__pycache__", ".idea",
]);
const PREFERRED_NAMES = [
  "style.css", "styles.css", "globals.css", "global.css", "app.css", "main.css", "theme.css", "tokens.css",
  "design-tokens.css", "variables.css", "index.css",
];
const MAX_DEPTH = 6;
const MAX_FILES = 6000;
const MAX_CSS_BYTES = 512 * 1024;
const MAX_FONT_BYTES = 400 * 1024;

const MIME_BY_EXTENSION = new Map([
  [".woff2", "font/woff2"],
  [".woff", "font/woff"],
  [".ttf", "font/ttf"],
  [".otf", "font/otf"],
]);

/**
 * Semantic names the structure sheet reads, in priority order. The first candidate that exists in the
 * project's variables wins; everything else keeps the structure sheet's own default.
 */
const SEMANTIC = {
  page: ["--page", "--background", "--bg", "--body-bg", "--color-bg", "--surface", "--brand-page", "--cream", "--brand-cream"],
  card: ["--card", "--surface-raised", "--surface-1", "--elevated", "--panel", "--color-surface", "--ds-card"],
  ink: ["--ink", "--text", "--foreground", "--fg", "--color-text", "--brand-ink"],
  "ink-2": ["--ink-2", "--text-2", "--text-secondary", "--secondary", "--color-text-muted", "--brand-ink-2"],
  muted: ["--mute", "--muted", "--text-muted", "--dim", "--brand-mute"],
  line: ["--line", "--border", "--divider", "--rule", "--color-border", "--brand-line"],
  accent: ["--accent", "--primary", "--brand", "--color-primary", "--turn", "--orange", "--brand-orange"],
  "accent-ink": ["--accent-ink", "--on-primary", "--primary-contrast", "--accent-contrast", "--ds-turn-ink"],
  positive: ["--positive", "--success", "--green", "--ok", "--brand-positive"],
  negative: ["--negative", "--danger", "--error", "--red", "--brand-negative"],
  radius: ["--radius", "--radius-card", "--radius-lg", "--radius-md", "--card-radius"],
  "font-sans": ["--font-sans", "--font-brand", "--font-body", "--font-family", "--font-base"],
  "font-mono": ["--font-mono", "--font-brand-mono", "--font-code", "--font-monospace"],
  shadow: ["--shadow", "--shadow-float", "--shadow-lg", "--shadow-card"],
};

function parseArguments(argv) {
  const options = { out: undefined, css: [], root: process.cwd(), json: false };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--out") options.out = argv[++index];
    else if (argument === "--css") options.css.push(argv[++index]);
    else if (argument === "--root") options.root = argv[++index];
    else if (argument === "--json") options.json = true;
    else if (argument === "--help" || argument === "-h") options.help = true;
    else return { error: `Unknown argument: ${argument}` };
  }
  if (options.help) return { options };
  if (typeof options.out !== "string" || options.out === "") return { error: "--out is required" };
  return { options };
}

async function walkCss(directory, depth, state) {
  if (depth > MAX_DEPTH || state.visited > MAX_FILES) return;
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    return;
  }
  for (const entry of entries) {
    if (state.visited++ > MAX_FILES) return;
    if (entry.name.startsWith(".") && entry.name !== ".") continue;
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      if (SKIP_DIRECTORIES.has(entry.name)) continue;
      await walkCss(path, depth + 1, state);
      continue;
    }
    if (!entry.isFile() || extname(entry.name) !== ".css") continue;
    if (state.candidates.length >= 400) continue;
    state.candidates.push(path);
  }
}

/** Count the custom properties a stylesheet declares, which is the cheapest signal of a token sheet. */
function customPropertyCount(source) {
  const matches = source.match(/(?:^|[\s;{])--[a-zA-Z0-9_-]+\s*:/g);
  return matches === null ? 0 : matches.length;
}

async function chooseSources(options) {
  const explicit = options.css.filter((value) => typeof value === "string" && value !== "");
  if (explicit.length > 0) {
    return { files: explicit.map((path) => resolve(process.cwd(), path)), discovered: false };
  }
  const state = { candidates: [], visited: 0 };
  await walkCss(resolve(options.root), 0, state);
  const scored = [];
  for (const path of state.candidates) {
    let info;
    try {
      info = await stat(path);
    } catch (error) {
      continue;
    }
    if (info.size > MAX_CSS_BYTES) continue;
    let source;
    try {
      source = await readFile(path, "utf8");
    } catch (error) {
      continue;
    }
    const properties = customPropertyCount(source);
    if (properties === 0) continue;
    const preferred = PREFERRED_NAMES.includes(basename(path)) ? 1 : 0;
    const depth = relative(resolve(options.root), path).split(/[\\/]/u).length;
    scored.push({ path, properties, preferred, depth, size: info.size });
  }
  if (scored.length === 0) return { files: [], discovered: true };
  scored.sort((a, b) => b.preferred - a.preferred || b.properties - a.properties || a.depth - b.depth);
  return { files: [scored[0].path], discovered: true, alternatives: scored.slice(1, 5).map((entry) => entry.path) };
}

/** The body of the block that opens at `openBrace`, by brace depth, so nested at-rules survive. */
function blockBodyAt(source, openBrace) {
  let depth = 0;
  for (let index = openBrace; index < source.length; index += 1) {
    const character = source[index];
    if (character === "{") depth += 1;
    else if (character === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(openBrace + 1, index);
    }
  }
  return undefined;
}

/** Pull `--name: value` pairs out of the root-ish blocks, keeping the last declaration of each name. */
function extractVariables(source) {
  const clean = source.replace(/\/\*[\s\S]*?\*\//g, "");
  const variables = new Map();
  const anchor = /(?:^|[\s,}])(?::root|html|@theme)\b/gi;
  let match = anchor.exec(clean);
  while (match !== null) {
    const open = clean.indexOf("{", match.index + match[0].length);
    if (open === -1) break;
    const body = blockBodyAt(clean, open);
    if (body !== undefined) {
      for (const [, name, value] of body.matchAll(/(--[a-zA-Z0-9_-]+)\s*:\s*([^;]+);/g)) {
        variables.set(name, value.trim());
      }
      anchor.lastIndex = open + 1;
    }
    match = anchor.exec(clean);
  }
  return variables;
}

function resolveChain(name, variables, seen = new Set()) {
  if (seen.has(name)) return undefined;
  seen.add(name);
  const value = variables.get(name);
  if (value === undefined) return undefined;
  const reference = /^var\(\s*(--[a-zA-Z0-9_-]+)\s*(?:,\s*([^)]+))?\)$/u.exec(value.trim());
  if (reference === null) return value;
  const resolved = resolveChain(reference[1], variables, seen);
  if (resolved !== undefined) return resolved;
  return reference[2]?.trim();
}

/** Inline `@font-face` sources that point at a local file, since the artifact cannot fetch them. */
async function collectFontFaces(files) {
  const faces = [];
  const warnings = [];
  for (const file of files) {
    let source;
    try {
      source = await readFile(file, "utf8");
    } catch (error) {
      warnings.push(`Not readable: ${file}`);
      continue;
    }
    const facePattern = /@font-face\s*\{([^}]*)\}/giu;
    let face = facePattern.exec(source);
    while (face !== null) {
      let body = face[1];
      const sourcePattern = /url\(\s*(['"]?)([^'")]+)\1\s*\)(?:\s*format\(([^)]*)\))?/giu;
      let url = sourcePattern.exec(body);
      while (url !== null) {
        const reference = url[2];
        if (/^(?:[a-z][a-z0-9+.-]*:|\/\/)/iu.test(reference)) {
          warnings.push(`Remote font left out: ${reference}`);
          url = sourcePattern.exec(body);
          continue;
        }
        const path = resolve(dirname(file), reference);
        const mime = MIME_BY_EXTENSION.get(extname(path).toLowerCase());
        if (mime === undefined) {
          url = sourcePattern.exec(body);
          continue;
        }
        let data;
        try {
          const info = await stat(path);
          if (info.size > MAX_FONT_BYTES) {
            warnings.push(`Font too large to inline: ${reference}`);
            url = sourcePattern.exec(body);
            continue;
          }
          data = await readFile(path);
        } catch (error) {
          warnings.push(`Font file missing: ${reference}`);
          url = sourcePattern.exec(body);
          continue;
        }
        body = body.replace(url[0], `url(data:${mime};base64,${data.toString("base64")})`);
        url = sourcePattern.exec(body);
      }
      faces.push(body.trim());
      face = facePattern.exec(source);
    }
  }
  return { faces, warnings };
}

function buildMapping(variables) {
  const mapping = new Map();
  const decisions = [];
  for (const [semantic, candidates] of Object.entries(SEMANTIC)) {
    const found = candidates.find((name) => variables.has(name));
    if (found === undefined) {
      decisions.push({ semantic, source: null, fallback: true });
      continue;
    }
    // A project variable that already carries the semantic name needs no mapping, and mapping it onto
    // itself would be a circular reference.
    if (found === `--${semantic}`) {
      decisions.push({ semantic, source: found, value: resolveChain(found, variables), self: true });
      continue;
    }
    mapping.set(semantic, `var(${found})`);
    decisions.push({ semantic, source: found, value: resolveChain(found, variables), fallback: false });
  }
  return { mapping, decisions };
}

async function main() {
  const parsed = parseArguments(process.argv.slice(2));
  if (parsed.error !== undefined) {
    console.error(parsed.error);
    return 1;
  }
  const options = parsed.options;
  if (options.help === true) {
    console.log("usage: node design-tokens.mjs --out <tokens.css> [--css <file>]... [--root <dir>] [--json]");
    return 0;
  }

  const sources = await chooseSources(options);
  if (sources.files.length === 0) {
    if (options.json) console.log(JSON.stringify({ ok: false, reason: "no design source found" }, null, 2));
    else console.error("No stylesheet with custom properties found. Pass one with --css <file>.");
    return 3;
  }

  const variables = new Map();
  for (const file of sources.files) {
    let source;
    try {
      source = await readFile(file, "utf8");
    } catch (error) {
      continue;
    }
    for (const [name, value] of extractVariables(source)) variables.set(name, value);
  }
  const { faces, warnings } = await collectFontFaces(sources.files);
  const { mapping, decisions } = buildMapping(variables);

  const lines = [];
  lines.push("/*");
  lines.push(" * Generated by design-tokens.mjs. Do not edit: regenerate it from the design source.");
  lines.push(` * Source: ${relative(process.cwd(), sources.files[0]) || sources.files[0]}`);
  lines.push(` * ${String(variables.size)} project variables, ${String(faces.length)} inlined font faces.`);
  lines.push(" */");
  if (faces.length > 0) {
    lines.push("");
    for (const face of faces) lines.push(`@font-face { ${face} }`);
  }
  lines.push("");
  lines.push(":root {");
  lines.push("  /* The project's own variables, copied verbatim. */");
  for (const [name, value] of variables) lines.push(`  ${name}: ${value};`);
  lines.push("");
  lines.push("  /* The names artifact.css reads, mapped to what the project calls them. */");
  for (const [semantic, value] of mapping) lines.push(`  --${semantic}: ${value};`);
  lines.push("}");
  lines.push("");

  await writeFile(resolve(process.cwd(), options.out), lines.join("\n"), "utf8");

  const summary = {
    ok: true,
    out: options.out,
    sources: sources.files.map((file) => relative(process.cwd(), file)),
    discovered: sources.discovered,
    alternatives: (sources.alternatives ?? []).map((file) => relative(process.cwd(), file)),
    variables: variables.size,
    fontFaces: faces.length,
    mapping: decisions,
    warnings,
  };
  if (options.json) {
    console.log(JSON.stringify(summary, null, 2));
  } else {
    console.log(`Wrote ${options.out} from ${summary.sources[0]}: ${String(variables.size)} variables, ${String(faces.length)} font faces.`);
    const missing = decisions.filter((decision) => decision.fallback).map((decision) => decision.semantic);
    if (missing.length > 0) console.log(`Defaults used for: ${missing.join(", ")}`);
    for (const warning of warnings) console.log(`Warning: ${warning}`);
  }
  return 0;
}

process.exitCode = await main();

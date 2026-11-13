import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const repoRoot = fileURLToPath(new URL("../", import.meta.url));
const HARNESS = "/test/support/harness.html";
const CONTENT_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
};

let server;
let browser;
let baseUrl;

before(async () => {
  server = createServer(async (request, response) => {
    const pathname = decodeURIComponent(new URL(request.url, "http://localhost").pathname);
    const filePath = resolve(repoRoot, `.${pathname}`);
    if (!filePath.startsWith(repoRoot)) {
      response.writeHead(404);
      response.end();
      return;
    }
    try {
      const body = await readFile(filePath);
      response.writeHead(200, { "content-type": CONTENT_TYPES[extname(filePath)] ?? "application/octet-stream" });
      response.end(body);
    } catch (error) {
      response.writeHead(404);
      response.end();
    }
  });
  await new Promise((done) => server.listen(0, "127.0.0.1", done));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch();
});

after(async () => {
  await browser?.close();
  await new Promise((done) => server.close(done));
});

/** Wait until the panel has composed its selected artifact, or its notice when there is nothing to show. */
async function waitForReady(page) {
  await page.waitForFunction(
    () => {
      const root = window.__panel?.shadowRoot;
      const iframe = root?.querySelector(".frame-holder iframe");
      const notice = root?.querySelector(".notice");
      return iframe?.srcdoc?.length > 0 && notice?.dataset.visible === "false";
    },
    undefined,
    { timeout: 15000 },
  );
}

async function openPanel(t, { width = 1000, session = "session-1", ready = true } = {}) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  t.after(async () => {
    await context.close();
  });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  await page.goto(`${baseUrl}${HARNESS}?width=${width}&session=${session}`, { waitUntil: "load" });
  await page.locator("artifact-panel").waitFor();
  if (ready) {
    await waitForReady(page);
  } else {
    await page.waitForFunction(
      () => window.__panel?.shadowRoot?.querySelector(".notice")?.dataset.visible === "true",
      undefined,
      { timeout: 15000 },
    );
  }
  return { context, page, errors };
}

function reviewFrame(page) {
  return page.locator("artifact-panel .frame-holder iframe").contentFrame();
}

async function iframeWidth(page) {
  return page.locator("artifact-panel .frame-holder iframe").evaluate((frame) => frame.getBoundingClientRect().width);
}

async function iframeHeight(page) {
  return page.locator("artifact-panel .frame-holder iframe").evaluate((frame) => frame.getBoundingClientRect().height);
}

/** The chevron rotates with a transition, so read the angle it settles on rather than a mid-flight matrix. */
async function chevronAngle(page) {
  return page.locator("artifact-panel .chevron").evaluate((element) => {
    const { a, b } = new DOMMatrixReadOnly(getComputedStyle(element).transform);
    return Math.round((Math.atan2(b, a) * 180) / Math.PI);
  });
}

test("lists this conversation's artifacts, inlines its stylesheet and renders the selected page", async (t) => {
  const { page, errors } = await openPanel(t);
  const panel = page.locator("artifact-panel");
  const tabs = panel.locator('[role="tab"]');

  assert.deepEqual(await tabs.allTextContents(), ["topic-b", "topic-a"]);
  assert.equal(await tabs.nth(0).getAttribute("aria-selected"), "true");
  assert.equal(await reviewFrame(page).locator("h1").textContent(), "Topic B artifact");

  await tabs.nth(1).click();
  await page.waitForFunction(
    () => window.__panel.shadowRoot.querySelector(".frame-holder iframe").srcdoc.includes("--harness-topic: a"),
  );
  assert.equal(await tabs.nth(1).getAttribute("aria-selected"), "true");
  assert.equal(await reviewFrame(page).locator("h1").textContent(), "Topic A artifact");
  assert.equal(await reviewFrame(page).locator(".lede").evaluate((element) => getComputedStyle(element).color), "rgb(85, 85, 85)");
  assert.deepEqual(errors, []);
});

test("folds the comments column, widens the page, and remembers the fold across a reload", async (t) => {
  const { page, errors } = await openPanel(t);
  const panel = page.locator("artifact-panel");
  const before = await iframeWidth(page);

  await panel.locator(".aside-head").click();
  await page.waitForFunction(() => window.__panel.shadowRoot.querySelector(".stage").dataset.collapsed === "true");
  assert.ok((await iframeWidth(page)) > before + 100);
  assert.equal(
    await panel.locator(".aside-body").evaluate((element) => getComputedStyle(element).display),
    "none",
  );
  assert.equal(await page.evaluate(() => localStorage.getItem("artifact:comments-collapsed:v1")), "true");

  await page.reload({ waitUntil: "load" });
  await waitForReady(page);
  assert.equal(
    await page.evaluate(() => window.__panel.shadowRoot.querySelector(".stage").dataset.collapsed),
    "true",
  );
  assert.deepEqual(errors, []);
});

test("turns a pick and a selection into comments, stages them, and restores an open draft", async (t) => {
  const { page, errors } = await openPanel(t);
  const panel = page.locator("artifact-panel");

  await reviewFrame(page).locator("h1").click();
  await page.waitForFunction(() => window.__panel.shadowRoot.querySelector(".draft").hidden === false);
  assert.match(await panel.locator(".draft .target").textContent(), /^<h1> body > main > h1/u);

  await panel.locator("textarea").fill("Name the customer, not the change.");
  await panel.locator('button:text-is("Add comment")').click();
  await page.waitForFunction(() => window.__panel.shadowRoot.querySelector(".count").textContent === "1");
  assert.equal(await panel.locator(".comment").count(), 1);

  await panel.locator('button:text-is("Send to chat")').click();
  const chip = await page.evaluate(() => window.__chip);
  assert.equal(chip.label, "Artifact: topic-b");
  assert.match(chip.text, /Review comments on test-results\/artifact\/session-1\/topic-b\/artifact\.html/u);
  assert.match(chip.text, /Name the customer, not the change\./u);

  // A text selection opens a draft that quotes the selection instead of a selector.
  await reviewFrame(page)
    .locator("li")
    .first()
    .evaluate((element) => {
      const range = document.createRange();
      range.selectNodeContents(element);
      const selection = getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
      element.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
    });
  await page.waitForFunction(() => window.__panel.shadowRoot.querySelector(".draft").hidden === false);
  assert.match(await panel.locator(".draft .target").textContent(), /^Text in <li>: "Second question"/u);
  await panel.locator('button:text-is("Cancel")').click();

  // An open draft survives a reload, and the reload reopens a folded column to show it.
  await reviewFrame(page).locator(".lede").click();
  await page.waitForFunction(() => window.__panel.shadowRoot.querySelector(".draft").hidden === false);
  await panel.locator("textarea").fill("Keep this draft across a reload.");
  await panel.locator(".aside-head").click();
  await page.waitForFunction(() => window.__panel.shadowRoot.querySelector(".stage").dataset.collapsed === "true");

  await page.reload({ waitUntil: "load" });
  await waitForReady(page);
  assert.equal(
    await page.evaluate(() => window.__panel.shadowRoot.querySelector(".stage").dataset.collapsed),
    "false",
  );
  assert.equal(await panel.locator("textarea").inputValue(), "Keep this draft across a reload.");
  assert.equal(await panel.locator(".comment").count(), 1);
  assert.deepEqual(errors, []);
});

test("Save PDF composes the artifact alone and hands a printable document to the browser", async (t) => {
  const { context, page, errors } = await openPanel(t);
  const panel = page.locator("artifact-panel");

  await page.evaluate(() => {
    window.__printDocs = [];
    new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        for (const node of mutation.addedNodes) {
          if (node instanceof HTMLIFrameElement && node.getAttribute("title") === "Artifact print view") {
            window.__printDocs.push(node.srcdoc);
          }
        }
      }
    }).observe(window.__panel.shadowRoot, { childList: true });
  });

  await panel.locator('button:text-is("Save PDF")').click();
  await page.waitForFunction(() => window.__printDocs.length === 1, undefined, { timeout: 15000 });
  const printDocument = await page.evaluate(() => window.__printDocs[0]);

  assert.doesNotMatch(printDocument, /data-review-hover/u);
  assert.doesNotMatch(printDocument, /<script>/u);
  assert.match(printDocument, /@page \{ margin: 0; \}/u);
  assert.match(printDocument, /<title>topic-b<\/title>/u);
  assert.match(printDocument, /Topic B artifact/u);
  assert.match(await panel.locator(".info").textContent(), /Choose Save as PDF/u);

  const printPage = await context.newPage();
  await printPage.setContent(printDocument, { waitUntil: "load" });
  const pdf = await printPage.pdf({ format: "A4", printBackground: true });
  assert.equal(pdf.subarray(0, 4).toString("latin1"), "%PDF");
  assert.ok(pdf.length > 5000, `expected a paginated PDF, got ${pdf.length} bytes`);
  await printPage.close();
  assert.deepEqual(errors, []);
});

test("stacks the comments below the frame when the panel is narrow", async (t) => {
  const { page, errors } = await openPanel(t, { width: 520 });
  const panel = page.locator("artifact-panel");
  const aside = panel.locator("aside");
  const border = await aside.evaluate((element) => {
    const style = getComputedStyle(element);
    return { top: style.borderTopWidth, left: style.borderLeftWidth };
  });
  assert.notEqual(border.top, "0px");
  assert.equal(border.left, "0px");
  await page.waitForFunction(() => {
    const element = window.__panel.shadowRoot.querySelector(".chevron");
    const { a, b } = new DOMMatrixReadOnly(getComputedStyle(element).transform);
    return Math.round((Math.atan2(b, a) * 180) / Math.PI) === 90;
  });
  assert.equal(await chevronAngle(page), 90);

  const before = await iframeHeight(page);
  await panel.locator(".aside-head").click();
  await page.waitForFunction(() => window.__panel.shadowRoot.querySelector(".stage").dataset.collapsed === "true");
  assert.ok((await iframeHeight(page)) > before + 30);
  await page.waitForFunction(() => {
    const element = window.__panel.shadowRoot.querySelector(".chevron");
    const { a, b } = new DOMMatrixReadOnly(getComputedStyle(element).transform);
    return Math.round((Math.atan2(b, a) * 180) / Math.PI) === -90;
  });
  assert.equal(await chevronAngle(page), -90);
  assert.deepEqual(errors, []);
});

test("binds to one conversation at a time and shows a notice without one", async (t) => {
  const second = await openPanel(t, { session: "session-2" });
  assert.deepEqual(await second.page.locator('artifact-panel [role="tab"]').allTextContents(), ["other"]);
  assert.equal(await reviewFrame(second.page).locator("h1").textContent(), "Session two artifact");
  assert.deepEqual(second.errors, []);

  const none = await openPanel(t, { session: "none", ready: false });
  const panel = none.page.locator("artifact-panel");
  assert.equal(await panel.locator(".notice h2").textContent(), "No conversation selected");
  assert.equal(await panel.locator(".tabs").getAttribute("hidden"), "");
  assert.equal(await panel.locator('button:text-is("Save PDF")').isDisabled(), true);
  assert.deepEqual(none.errors, []);
});

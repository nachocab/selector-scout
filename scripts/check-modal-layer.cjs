const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { spawnSync } = require("node:child_process");

const cli = process.env.PWCLI || path.join(os.homedir(), ".codex/skills/playwright/scripts/playwright_cli.sh");
const session = `scout-modal-${Date.now()}-${process.pid}`;
const source = fs.readFileSync(path.join(__dirname, "../selector-scout.js"), "utf8");

function run(...args) {
  const result = spawnSync(cli, ["--session", session, ...args], { encoding: "utf8" });
  process.stdout.write((result.stdout || "").replace(/### Ran Playwright code\n```js\n[\s\S]*?```\n/g, ""));
  if (result.error) throw result.error;
  if (result.status || /### Error/.test(result.stdout)) throw new Error(result.stderr || result.stdout);
}

async function checkModals(page, source) {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.setContent(`<style>
    body { background: #111; color: #eee; }
    dialog { width: 90vw; height: 90vh; background: #222; color: #eee; }
    dialog::backdrop { background: rgb(0 0 0 / .7); }
  </style>
  <button id="outside">Outside</button>
  <dialog id="first"><button id="expense">Expense</button></dialog>
  <dialog id="second"><button id="nested">Nested</button></dialog>
  <div id="menu" popover="manual" style="position:fixed;inset:0;width:100vw;height:100vh">Menu</div>`);
  await page.evaluate(() => document.querySelector("#first").showModal());
  await page.addScriptTag({ content: source });

  async function assertPanel(parentId) {
    await page.waitForFunction((parentId) => {
      const panel = document.querySelector('[data-selector-scout-ui][role="status"]');
      if (!panel || panel.parentElement.id !== parentId) return false;
      const r = panel.getBoundingClientRect();
      return panel.matches(":popover-open") && panel.contains(document.elementFromPoint(r.left + 20, r.top + 20));
    }, parentId, { timeout: 3000 });
  }

  // Activation while a modal is already open: the exact reported failure.
  await assertPanel("first");
  const panel = page.locator('[data-selector-scout-ui][role="status"]');
  const before = await panel.boundingBox();
  await page.mouse.move(before.x + before.width / 2, before.y + 18);
  await page.mouse.down();
  await page.mouse.move(before.x + before.width / 2 - 60, before.y - 80);
  await page.mouse.up();
  const after = await panel.boundingBox();
  if (after.x === before.x || after.y === before.y) throw new Error("Panel cannot be dragged above a modal");
  await page.mouse.move(after.x + after.width - 8, after.y + after.height - 8);
  await page.mouse.down();
  await page.mouse.move(after.x + after.width - 100, after.y + after.height + 40);
  await page.mouse.up();
  const resized = await panel.boundingBox();
  if (resized.width === after.width) throw new Error("Panel cannot be resized above a modal");

  await page.locator("#expense").hover();
  await page.waitForFunction(() => {
    const outline = document.querySelector('[data-selector-scout-ui][aria-hidden="true"][popover]');
    const target = document.querySelector("#expense");
    return outline.matches(":popover-open") && outline.getBoundingClientRect().width === target.getBoundingClientRect().width;
  });
  await page.locator("#expense").click();
  if (!(await panel.textContent()).includes("#expense")) throw new Error("Modal element cannot be selected");

  // Later top-layer additions must not cover an already active inspector.
  await page.evaluate(() => document.querySelector("#menu").showPopover());
  await assertPanel("first");
  await page.evaluate(() => document.querySelector("#menu").hidePopover());
  await page.evaluate(() => document.querySelector("#second").showModal());
  await assertPanel("second");
  await page.evaluate(() => document.querySelector("#second").close());
  await assertPanel("first");

  // Reopening in a different order exercises active modal selection, not DOM order.
  await page.evaluate(() => {
    document.querySelector("#first").close();
    document.querySelector("#second").showModal();
    document.querySelector("#first").showModal();
  });
  await assertPanel("first");
  await page.evaluate(() => document.querySelector("#first").remove());
  await assertPanel("second");
  await page.evaluate(() => document.querySelector("#second").close());
  await assertPanel("");
  await page.evaluate(() => {
    const overlay = document.createElement("div");
    overlay.style.cssText = "position:fixed;inset:0;z-index:2147483647;background:#333";
    document.body.append(overlay);
  });
  await assertPanel("");

  await page.evaluate(() => document.querySelector("#second").showModal());
  await assertPanel("second");
  await page.keyboard.press("Escape");
  if (await panel.count()) throw new Error("Escape did not remove inspector UI");
  if (!(await page.locator("#second").evaluate((dialog) => dialog.open))) throw new Error("Inspector Escape closed the page modal");
  await page.evaluate(() => globalThis.__SELECTOR_SCOUT_CONTROLLER__.toggle());
  await assertPanel("second");
  await page.evaluate(() => globalThis.__SELECTOR_SCOUT_CONTROLLER__.toggle());
  await page.evaluate(() => document.querySelector("#second").close());
  if (await page.locator("[data-selector-scout-ui]").count()) throw new Error("Deactivation left inspector UI behind");
  if (errors.length) throw new Error(errors.join("\n"));
  return "PASS: modal visibility, dragging, resizing, selection, popovers, nested/reordered dialogs, removal, CSS overlays, Escape, and cleanup";
}

try {
  run("open", "about:blank");
  run("run-code", `async (page) => (${checkModals.toString()})(page, ${JSON.stringify(source)})`);
} finally {
  run("close");
}

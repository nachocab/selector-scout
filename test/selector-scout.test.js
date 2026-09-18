const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

function loadHelpers() {
  const source = fs.readFileSync(path.join(__dirname, "..", "selector-scout.user.js"), "utf8");
  const context = {
    __SELECTOR_SCOUT_TEST__: true,
    CSS: { escape: (value) => value.replace(/[^a-zA-Z0-9_-]/g, (character) => `\\${character}`) },
  };
  context.globalThis = context;
  vm.runInNewContext(source, context);
  return context.__SELECTOR_SCOUT_TEST_EXPORTS__;
}

function element(tagName, { id = "", classes = [], owned = false } = {}) {
  return {
    tagName: tagName.toUpperCase(),
    id,
    classList: classes,
    dataset: owned ? { selectorScoutUi: "" } : {},
    children: [],
    parentElement: null,
    append(...children) {
      for (const child of children) {
        child.parentElement = this;
        this.children.push(child);
      }
    },
    get previousElementSibling() {
      if (!this.parentElement) return null;
      const index = this.parentElement.children.indexOf(this);
      return index > 0 ? this.parentElement.children[index - 1] : null;
    },
    get nextElementSibling() {
      if (!this.parentElement) return null;
      const index = this.parentElement.children.indexOf(this);
      return this.parentElement.children[index + 1] ?? null;
    },
  };
}

test("formats the hovered element as tag, id, and classes", () => {
  const { describeElement } = loadHelpers();
  assert.equal(describeElement(element("button", { id: "save", classes: ["primary", "large"] })), "button#save.primary.large");
});

test("builds an escaped unique selector from an id", () => {
  const { buildSelector } = loadHelpers();
  const target = element("section", { id: "account:details" });
  const document = { querySelectorAll: (selector) => (selector === "#account\\:details" ? [target] : []) };
  assert.equal(buildSelector(target, document), "#account\\:details");
});

test("builds a short unique class selector when no id is present", () => {
  const { buildSelector } = loadHelpers();
  const target = element("button", { classes: ["buy", "primary"] });
  const document = { querySelectorAll: (selector) => (selector === "button.buy.primary" ? [target] : []) };
  assert.equal(buildSelector(target, document), "button.buy.primary");
});

test("navigates to parent, first child, and adjacent siblings", () => {
  const { navigate } = loadHelpers();
  const parent = element("main");
  const first = element("section", { id: "first" });
  const middle = element("section", { id: "middle" });
  const last = element("section", { id: "last" });
  const child = element("button");
  parent.append(first, middle, last);
  middle.append(child);

  assert.equal(navigate(middle, "up"), parent);
  assert.equal(navigate(middle, "down"), child);
  assert.equal(navigate(middle, "left"), first);
  assert.equal(navigate(middle, "right"), last);
});

test("navigation skips Selector Scout interface nodes", () => {
  const { navigate } = loadHelpers();
  const parent = element("main");
  const first = element("section");
  const overlay = element("div", { owned: true });
  const last = element("article");
  parent.append(first, overlay, last);

  assert.equal(navigate(first, "right"), last);
  assert.equal(navigate(last, "left"), first);
});

test("clipboard failure falls back without leaking a rejected promise", async () => {
  const { writeClipboard } = loadHelpers();
  let fallbackText = "";

  const copied = await writeClipboard("#gamma", {
    clipboardWrite: () => Promise.reject(new Error("permission denied")),
    legacyCopy: (text) => {
      fallbackText = text;
      return true;
    },
  });

  assert.equal(copied, true);
  assert.equal(fallbackText, "#gamma");
});

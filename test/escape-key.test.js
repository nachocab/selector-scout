const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

test("Escape exits selection mode without reaching the page, even with modifiers", () => {
  for (const modifiers of [{}, { metaKey: true }, { ctrlKey: true }, { altKey: true }]) {
    const listeners = new Map();
    const root = { style: { cursor: "" }, append() {} };
    const document = {
      documentElement: root,
      createElement: () => ({ dataset: {}, style: {}, setAttribute() {}, append() {}, replaceChildren() {}, remove() {} }),
      addEventListener: (name, listener) => listeners.set(name, listener),
      removeEventListener() {},
    };
    const context = { document, window: { addEventListener() {} }, clearTimeout() {} };
    context.globalThis = context;
    vm.runInNewContext(fs.readFileSync(path.join(__dirname, "..", "selector-scout.js"), "utf8"), context);

    let prevented = false;
    let stopped = false;
    let pageReceived = false;
    listeners.get("keydown")({
      key: "Escape",
      ...modifiers,
      preventDefault: () => (prevented = true),
      stopImmediatePropagation: () => (stopped = true),
    });
    if (!stopped) pageReceived = true;

    assert.equal(prevented, true);
    assert.equal(pageReceived, false);
    assert.equal(root.style.cursor, "");

    prevented = false;
    stopped = false;
    listeners.get("keydown")({
      key: "Escape",
      preventDefault: () => (prevented = true),
      stopImmediatePropagation: () => (stopped = true),
    });
    if (!stopped) pageReceived = true;
    assert.equal(prevented, false);
    assert.equal(pageReceived, true);
  }
});

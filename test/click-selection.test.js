const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

test("a click selects and copies its target without a preceding pointer move", async () => {
  const listeners = new Map();
  const copied = [];
  let pendingFrame;
  const root = {
    style: { cursor: "" },
    append(...children) { this.children = children; },
  };
  const target = {
    tagName: "BUTTON",
    id: "save",
    classList: [],
    dataset: {},
    parentElement: null,
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 80, height: 30 }),
  };
  const nextTarget = { ...target, id: "cancel", getBoundingClientRect: () => ({ left: 100, top: 0, width: 80, height: 30 }) };
  const document = {
    documentElement: root,
    createElement: () => ({
      dataset: {},
      style: {},
      setAttribute() {},
      append() {},
      replaceChildren() {},
      remove() {},
    }),
    querySelectorAll: (selector) => (selector === "#save" ? [target] : selector === "#cancel" ? [nextTarget] : []),
    elementFromPoint: () => nextTarget,
    addEventListener: (name, listener) => listeners.set(name, listener),
  };
  const context = {
    document,
    window: { addEventListener() {} },
    navigator: { clipboard: { writeText: async (value) => copied.push(value) } },
    getComputedStyle: () => ({ color: "rgb(0, 0, 0)", backgroundColor: "transparent", paddingTop: "0px", paddingRight: "0px", paddingBottom: "0px", paddingLeft: "0px", marginTop: "0px", marginRight: "0px", marginBottom: "0px", marginLeft: "0px", lineHeight: "normal" }),
    requestAnimationFrame: (callback) => {
      pendingFrame = callback;
      return 1;
    },
    setTimeout: () => 1,
    clearTimeout() {},
  };
  context.globalThis = context;
  const source = fs.readFileSync(path.join(__dirname, "..", "selector-scout.js"), "utf8");
  vm.runInNewContext(source, context);

  listeners.get("pointermove")({ target: nextTarget, clientX: 5, clientY: 5 });
  let prevented = false;
  listeners.get("click")({
    target,
    preventDefault: () => (prevented = true),
    stopImmediatePropagation() {},
  });
  await Promise.resolve();

  assert.equal(prevented, true);
  assert.deepEqual(copied, ["#save"]);
  pendingFrame();
  assert.equal(root.children[0].style.left, "0px");

  pendingFrame = null;
  listeners.get("pointermove")({ target: nextTarget, clientX: 5, clientY: 5 });
  assert.equal(pendingFrame, null);
  listeners.get("click")({
    target: nextTarget,
    preventDefault() {},
    stopImmediatePropagation() {},
  });
  await Promise.resolve();

  assert.deepEqual(copied, ["#save", "#cancel"]);
  assert.equal(root.children[0].style.left, "100px");
});

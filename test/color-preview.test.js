const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const source = fs.readFileSync(path.join(__dirname, "..", "selector-scout.js"), "utf8");

function node() {
  return {
    dataset: {},
    style: {},
    children: [],
    textContent: "",
    setAttribute() {},
    append(...nodes) { this.children.push(...nodes); },
    replaceChildren(...nodes) { this.children = nodes; },
    remove() {},
  };
}

function renderFor(colors) {
  const listeners = new Map();
  const frames = [];
  const target = {
    tagName: "P",
    id: "intro",
    classList: [],
    dataset: {},
    parentElement: null,
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 100, height: 20 }),
  };
  const root = { style: { cursor: "" }, append(...children) { this.children = children; } };
  const document = {
    documentElement: root,
    createElement: node,
    querySelectorAll: (selector) => (selector === "#intro" ? [target] : []),
    elementFromPoint: () => target,
    addEventListener: (name, listener) => listeners.set(name, listener),
    removeEventListener() {},
  };
  const context = {
    document,
    window: { addEventListener() {}, innerWidth: 1000, innerHeight: 800 },
    getComputedStyle: () => ({ lineHeight: "normal", ...colors }),
    requestAnimationFrame: (callback) => frames.push(callback),
    setTimeout: () => 1,
    clearTimeout() {},
  };
  context.globalThis = context;
  vm.runInNewContext(source, context);

  listeners.get("pointermove")({ target, clientX: 5, clientY: 5 });
  for (const frame of frames.splice(0)) frame();
  const [, panel] = root.children;
  const [, body] = panel.children;
  return body;
}

function row(body, label) {
  return body.children.find((child) => child.children[0]?.textContent.startsWith(label));
}

test("color rows pair a swatch of the computed color with its hex value", () => {
  const body = renderFor({ color: "rgb(31, 31, 31)", backgroundColor: "rgba(255, 0, 0, 0.5)" });

  const [, colorSwatch, colorValue] = row(body, "COLOR").children;
  assert.equal(colorValue.textContent, "#1F1F1F");
  assert.match(colorSwatch.style.backgroundImage, /linear-gradient\(rgb\(31, 31, 31\), rgb\(31, 31, 31\)\)/);
  assert.equal(colorSwatch.style.width, "10px");

  const [, backgroundSwatch, backgroundValue] = row(body, "BACKGROUND").children;
  assert.equal(backgroundValue.textContent, "#FF000080");
  assert.match(backgroundSwatch.style.backgroundImage, /conic-gradient/);
});

test("a fully transparent color reads as transparent instead of a zero-alpha hex", () => {
  const body = renderFor({ color: "rgb(0, 0, 0)", backgroundColor: "rgba(0, 0, 0, 0)" });

  assert.equal(row(body, "BACKGROUND").children[2].textContent, "transparent");
});

test("colors outside the rgb serialization keep their computed text", () => {
  const { formatColor } = (() => {
    const context = { __SELECTOR_SCOUT_TEST__: true };
    context.globalThis = context;
    vm.runInNewContext(source, context);
    return context.__SELECTOR_SCOUT_TEST_EXPORTS__;
  })();

  assert.equal(formatColor("color(display-p3 0.5 0.1 0.1)"), "color(display-p3 0.5 0.1 0.1)");
  assert.equal(formatColor("rgb(255 255 255)"), "#FFFFFF");
  assert.equal(formatColor("rgba(9, 8, 7, 1)"), "#090807");
});

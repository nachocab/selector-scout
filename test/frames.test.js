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

function fakeDocument(elements) {
  const listeners = new Map();
  return {
    listeners,
    documentElement: { style: { cursor: "" }, append(...children) { this.children = children; } },
    createElement: node,
    querySelectorAll: (selector) => elements[selector] ?? [],
    addEventListener: (name, listener) => listeners.set(name, listener),
    removeEventListener: (name, listener) => listeners.get(name) === listener && listeners.delete(name),
  };
}

const style = { color: "rgb(0, 0, 0)", backgroundColor: "rgb(255, 255, 255)", lineHeight: "normal" };

// A top page hosting #main, a same-origin iframe placed at 50,56 with a 3px border and 7px padding.
function loadScout() {
  const frameElement = {
    tagName: "IFRAME",
    id: "main",
    classList: [],
    dataset: {},
    parentElement: null,
    children: [],
    clientLeft: 3,
    clientTop: 3,
    matches: (selector) => selector === "iframe, frame",
    getBoundingClientRect: () => ({ left: 50, top: 56, width: 800, height: 600 }),
  };
  const topDocument = fakeDocument({ "iframe, frame": [frameElement], "#main": [frameElement] });
  const window = {
    addEventListener() {},
    innerWidth: 1000,
    innerHeight: 800,
    getComputedStyle: (element) => (element === frameElement ? { paddingLeft: "7px", paddingTop: "7px" } : style),
  };
  frameElement.ownerDocument = topDocument;
  topDocument.defaultView = window;

  const target = {
    tagName: "BUTTON",
    id: "save",
    classList: [],
    dataset: {},
    parentElement: null,
    getBoundingClientRect: () => ({ left: 10, top: 40, width: 80, height: 30 }),
  };
  const frameDocument = fakeDocument({ "#save": [target] });
  const frameScrolls = [];
  frameDocument.defaultView = {
    frameElement,
    getComputedStyle: () => style,
    addEventListener: (name) => frameScrolls.push(name),
    removeEventListener: (name) => frameScrolls.splice(frameScrolls.indexOf(name), 1),
  };
  frameDocument.elementFromPoint = () => target;
  frameElement.contentDocument = frameDocument;
  target.ownerDocument = frameDocument;

  const animationFrames = [];
  const context = {
    document: topDocument,
    window,
    getComputedStyle: () => style,
    requestAnimationFrame: (callback) => animationFrames.push(callback),
    cancelAnimationFrame() {},
    setTimeout: () => 1,
    clearTimeout() {},
  };
  context.globalThis = context;
  vm.runInNewContext(source, context);
  return { context, topDocument, frameDocument, frameScrolls, target, animationFrames };
}

function rowText(row) {
  return row.children.map((child) => child.textContent).join("");
}

test("hovering inside a same-origin frame selects the element under the pointer", () => {
  const { topDocument, frameDocument, frameScrolls, target, animationFrames } = loadScout();

  assert.equal(frameDocument.documentElement.style.cursor, "crosshair");
  assert.deepEqual(frameScrolls, ["scroll"]);
  frameDocument.listeners.get("pointermove")({ target, clientX: 15, clientY: 45 });
  for (const callback of animationFrames.splice(0)) callback();

  const [outline, panel] = topDocument.documentElement.children;
  // Frame origin 50,56 plus its 3px border and 7px padding, plus the element's own offset.
  assert.equal(outline.style.left, "70px");
  assert.equal(outline.style.top, "106px");
  const rows = panel.children[1].children.map(rowText);
  assert.ok(rows.includes("FRAME       #main"), rows.join("\n"));
  assert.ok(rows.includes("SELECTOR    #save"), rows.join("\n"));
});

test("arrow keys cross from a frame's root to its host frame and back", () => {
  const { topDocument, frameDocument, target, animationFrames } = loadScout();
  const body = { ...target, tagName: "BODY", id: "", getBoundingClientRect: target.getBoundingClientRect };
  frameDocument.body = body;
  frameDocument.listeners.get("pointermove")({ target, clientX: 15, clientY: 45 });
  for (const callback of animationFrames.splice(0)) callback();

  const press = (key) => frameDocument.listeners.get("keydown")({ key, preventDefault() {}, stopImmediatePropagation() {} });
  const panelRows = () => topDocument.documentElement.children[1].children[1].children.map(rowText);
  press("ArrowUp");
  assert.ok(panelRows().includes("SELECTOR    #main"), panelRows().join("\n"));
  assert.ok(!panelRows().some((row) => row.startsWith("FRAME")));
  press("ArrowDown");
  assert.ok(panelRows().includes("ELEMENT     body"), panelRows().join("\n"));
});

test("a frame that loads a new document is attached, and leaving restores every frame", () => {
  const { context, topDocument, frameDocument } = loadScout();
  const [frameElement] = topDocument.querySelectorAll("iframe, frame");
  const nextDocument = fakeDocument({});
  nextDocument.defaultView = { ...frameDocument.defaultView, addEventListener() {}, removeEventListener() {} };
  frameElement.contentDocument = nextDocument;
  topDocument.listeners.get("load")({ target: frameElement });

  assert.equal(nextDocument.documentElement.style.cursor, "crosshair");
  assert.ok(nextDocument.listeners.has("pointermove"));

  context.__SELECTOR_SCOUT_CONTROLLER__.toggle();
  for (const document of [frameDocument, nextDocument]) {
    assert.equal(document.documentElement.style.cursor, "");
    assert.equal(document.listeners.size, 0);
  }
});

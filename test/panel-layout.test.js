const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const source = fs.readFileSync(path.join(__dirname, "..", "selector-scout.js"), "utf8");

// The panel starts 400x100 at 300,690; explicit pixel styles then drive its measured box.
function pixels(value, fallback) {
  return typeof value === "string" && value.endsWith("px") ? Number.parseFloat(value) : fallback;
}

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
    getBoundingClientRect() {
      return {
        left: pixels(this.style.left, 300),
        top: pixels(this.style.top, 690),
        width: pixels(this.style.width, 400),
        height: pixels(this.style.height, 100),
      };
    },
  };
}

function loadScout() {
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
  const window = { addEventListener: (name, listener) => listeners.set(name, listener), innerWidth: 1000, innerHeight: 800 };
  const context = {
    document,
    window,
    getComputedStyle: () => ({ color: "rgb(0, 0, 0)", backgroundColor: "rgb(255, 255, 255)", lineHeight: "normal" }),
    requestAnimationFrame: (callback) => frames.push(callback),
    cancelAnimationFrame() {},
    setTimeout: () => 1,
    clearTimeout() {},
  };
  context.globalThis = context;
  vm.runInNewContext(source, context);

  // Select an element so the panel renders its labelled rows.
  listeners.get("pointermove")({ target, clientX: 5, clientY: 5 });
  for (const frame of frames.splice(0)) frame();

  const panel = () => root.children[1];
  const [grip, body, resizeHandle] = panel().children;
  return { listeners, frames, context, panel, grip, body, resizeHandle, target, window };
}

function pointerDown(listeners, target, clientX, clientY) {
  let prevented = false;
  let stopped = false;
  listeners.get("pointerdown")({
    target,
    button: 0,
    pointerId: 1,
    clientX,
    clientY,
    preventDefault: () => (prevented = true),
    stopPropagation: () => (stopped = true),
  });
  return { prevented, stopped };
}

function pointerMove(listeners, target, clientX, clientY) {
  listeners.get("pointermove")({ target, pointerId: 1, clientX, clientY });
}

test("dragging the grip repositions the panel and pins it to explicit coordinates", () => {
  const { listeners, frames, panel, grip } = loadScout();

  assert.equal(panel().style.bottom, "20px");
  const { prevented, stopped } = pointerDown(listeners, grip, 320, 700);
  assert.equal(prevented, true);
  assert.equal(stopped, true);
  assert.equal(grip.style.cursor, "grabbing");

  pointerMove(listeners, grip, 120, 200);

  assert.equal(panel().style.left, "100px");
  assert.equal(panel().style.top, "190px");
  assert.equal(panel().style.bottom, "auto");
  assert.equal(panel().style.transform, "none");
  // A drag must not re-target the selection under the pointer.
  assert.equal(frames.length, 0);

  listeners.get("pointerup")({ pointerId: 1 });
  assert.equal(grip.style.cursor, "grab");
  pointerMove(listeners, panel().children[1], 400, 400);
  assert.equal(panel().style.left, "100px");
});

test("a dragged panel stays inside the viewport, including after a resize", () => {
  const { listeners, panel, grip, window } = loadScout();

  pointerDown(listeners, grip, 320, 700);
  pointerMove(listeners, grip, 5000, -500);

  assert.equal(panel().style.left, "600px");
  assert.equal(panel().style.top, "0px");

  listeners.get("pointerup")({ pointerId: 1 });
  window.innerWidth = 500;
  window.innerHeight = 300;
  listeners.get("resize")({});

  assert.equal(panel().style.left, "100px");
  assert.equal(panel().style.top, "0px");
});

test("labels drag the panel while values stay selectable text", () => {
  const { listeners, panel, body } = loadScout();
  const [label, value] = body.children[1].children;

  assert.equal(pointerDown(listeners, value, 320, 700).prevented, false);
  pointerMove(listeners, value, 120, 200);
  assert.equal(panel().style.left, "50%");

  assert.equal(pointerDown(listeners, label, 320, 700).prevented, true);
  pointerMove(listeners, label, 120, 200);
  assert.equal(panel().style.left, "100px");
});

test("dragging the corner resizes the panel from its anchored top left corner", () => {
  const { listeners, panel, resizeHandle } = loadScout();

  assert.equal(pointerDown(listeners, resizeHandle, 700, 790).prevented, true);
  // Pinning to explicit coordinates keeps the top left corner still while the panel grows.
  assert.equal(panel().style.left, "300px");
  assert.equal(panel().style.top, "690px");

  pointerMove(listeners, resizeHandle, 760, 830);

  assert.equal(panel().style.width, "460px");
  // 800 - 690 is all the height left below the anchored top edge.
  assert.equal(panel().style.height, "110px");
  assert.equal(panel().style.left, "300px");
});

test("a resized panel keeps a usable minimum and refits a shrunken viewport", () => {
  const { listeners, panel, resizeHandle, window } = loadScout();

  pointerDown(listeners, resizeHandle, 700, 790);
  pointerMove(listeners, resizeHandle, 200, 300);

  assert.equal(panel().style.width, "220px");
  assert.equal(panel().style.height, "72px");

  pointerMove(listeners, resizeHandle, 4000, 4000);
  assert.equal(panel().style.width, "700px");
  assert.equal(panel().style.height, "110px");

  listeners.get("pointerup")({ pointerId: 1 });
  window.innerWidth = 620;
  listeners.get("resize")({});

  assert.equal(panel().style.left, "0px");
  assert.equal(panel().style.width, "620px");
});

test("the panel keeps its position and size across a toggle", () => {
  const { listeners, context, panel, grip, resizeHandle } = loadScout();

  pointerDown(listeners, grip, 320, 700);
  pointerMove(listeners, grip, 120, 200);
  listeners.get("pointerup")({ pointerId: 1 });
  pointerDown(listeners, resizeHandle, 700, 790);
  pointerMove(listeners, resizeHandle, 740, 810);
  listeners.get("pointerup")({ pointerId: 1 });

  assert.equal(panel().style.width, "440px");

  context.__SELECTOR_SCOUT_CONTROLLER__.toggle();
  context.__SELECTOR_SCOUT_CONTROLLER__.toggle();

  assert.equal(panel().style.left, "100px");
  assert.equal(panel().style.top, "190px");
  assert.equal(panel().style.width, "440px");
  assert.equal(panel().style.height, "120px");
});

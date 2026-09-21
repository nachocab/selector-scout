(function () {
  "use strict";

  const UI_ATTRIBUTE = "selectorScoutUi";
  const DRAG_ATTRIBUTE = "selectorScoutDrag";
  const MIN_PANEL_WIDTH = 220;
  const MIN_PANEL_HEIGHT = 72;
  const LAYOUT_KEY = "selectorScoutPanel";

  function escapeCss(value) {
    if (globalThis.CSS?.escape) return globalThis.CSS.escape(value);
    return String(value).replace(/(^-?\d)|[^a-zA-Z0-9_-]/g, (match) => `\\${match}`);
  }

  function describeElement(element) {
    const tag = element.tagName.toLowerCase();
    const id = element.id ? `#${element.id}` : "";
    const classes = Array.from(element.classList, (name) => `.${name}`).join("");
    return `${tag}${id}${classes}`;
  }

  function isUnique(selector, element, rootDocument) {
    try {
      const matches = rootDocument.querySelectorAll(selector);
      return matches.length === 1 && matches[0] === element;
    } catch {
      return false;
    }
  }

  function selectorSegment(element) {
    const tag = element.tagName.toLowerCase();
    const classes = Array.from(element.classList, (name) => `.${escapeCss(name)}`).join("");
    let segment = `${tag}${classes}`;
    const parent = element.parentElement;

    if (parent) {
      const sameTagSiblings = Array.from(parent.children).filter((child) => child.tagName === element.tagName);
      if (sameTagSiblings.length > 1) segment += `:nth-of-type(${sameTagSiblings.indexOf(element) + 1})`;
    }

    return segment;
  }

  function buildSelector(element, rootDocument = document) {
    if (element.id) {
      const idSelector = `#${escapeCss(element.id)}`;
      if (isUnique(idSelector, element, rootDocument)) return idSelector;
    }

    const directSelector = selectorSegment(element);
    if (isUnique(directSelector, element, rootDocument)) return directSelector;

    const segments = [directSelector];
    let ancestor = element.parentElement;
    while (ancestor && ancestor.tagName.toLowerCase() !== "html") {
      if (ancestor.id) {
        segments.unshift(`#${escapeCss(ancestor.id)}`);
        return segments.join(" > ");
      }
      segments.unshift(selectorSegment(ancestor));
      const selector = segments.join(" > ");
      if (isUnique(selector, element, rootDocument)) return selector;
      ancestor = ancestor.parentElement;
    }
    return segments.join(" > ");
  }

  function isOwned(element) {
    return Boolean(element?.dataset && UI_ATTRIBUTE in element.dataset);
  }

  function adjacentNonUi(element, property) {
    let candidate = element[property];
    while (candidate && isOwned(candidate)) candidate = candidate[property];
    return candidate;
  }

  function navigate(element, direction) {
    if (!element) return null;
    if (direction === "up") return adjacentNonUi(element, "parentElement");
    if (direction === "left") return adjacentNonUi(element, "previousElementSibling");
    if (direction === "right") return adjacentNonUi(element, "nextElementSibling");
    if (direction === "down") return Array.from(element.children).find((child) => !isOwned(child)) ?? null;
    return null;
  }

  function colorChannels(value) {
    const match = /^rgba?\(([^)]+)\)$/.exec(String(value).trim());
    if (!match) return null;
    const numbers = match[1].split(/[\s,/]+/).filter(Boolean).map(Number);
    if (numbers.length < 3 || numbers.some(Number.isNaN)) return null;
    return numbers;
  }

  function formatColor(value) {
    const channels = colorChannels(value);
    if (!channels) return value;
    const [red, green, blue, alpha = 1] = channels;
    if (alpha === 0) return "transparent";
    const bytes = alpha < 1 ? [red, green, blue, alpha * 255] : [red, green, blue];
    return `#${bytes.map((byte) => Math.round(byte).toString(16).padStart(2, "0")).join("").toUpperCase()}`;
  }

  function clamp(value, min, max) {
    return Math.min(Math.max(value, min), Math.max(min, max));
  }

  // chrome.storage carries the panel layout between page loads and across sites; a page's own
  // localStorage is the fallback for the fixture and any other plain-script injection.
  function layoutStore() {
    return globalThis.chrome?.storage?.local ?? null;
  }

  async function loadLayout() {
    try {
      const store = layoutStore();
      if (store) return (await store.get(LAYOUT_KEY))?.[LAYOUT_KEY] ?? null;
      const raw = globalThis.localStorage?.getItem(LAYOUT_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }

  function saveLayout(layout) {
    try {
      const store = layoutStore();
      if (store) {
        void Promise.resolve(store.set({ [LAYOUT_KEY]: layout })).catch(() => {});
        return;
      }
      globalThis.localStorage?.setItem(LAYOUT_KEY, JSON.stringify(layout));
    } catch {
      // A remembered layout is a convenience, so blocked storage is not worth reporting.
    }
  }

  function finiteBox(box, keys) {
    return box && keys.every((key) => Number.isFinite(box[key])) ? box : null;
  }

  async function writeClipboard(text, { clipboardWrite, legacyCopy }) {
    if (clipboardWrite) {
      try {
        await clipboardWrite(text);
        return true;
      } catch {
        // Continue to the synchronous fallback.
      }
    }
    return Boolean(legacyCopy?.(text));
  }

  if (globalThis.__SELECTOR_SCOUT_TEST__) {
    globalThis.__SELECTOR_SCOUT_TEST_EXPORTS__ = { buildSelector, describeElement, formatColor, navigate, writeClipboard };
    return;
  }

  if (globalThis.__SELECTOR_SCOUT_CONTROLLER__) {
    globalThis.__SELECTOR_SCOUT_CONTROLLER__.toggle();
    return;
  }

  const state = {
    active: false,
    selected: null,
    locked: false,
    rafId: null,
    lastPointer: null,
    outline: null,
    panel: null,
    grip: null,
    body: null,
    resizeHandle: null,
    drag: null,
    resize: null,
    panelOffset: null,
    panelSize: null,
    toastTimer: null,
    toastLine: null,
    originalCursor: "",
  };

  function createUi() {
    const outline = document.createElement("div");
    outline.dataset[UI_ATTRIBUTE] = "";
    outline.setAttribute("aria-hidden", "true");
    Object.assign(outline.style, {
      position: "fixed",
      display: "none",
      pointerEvents: "none",
      boxSizing: "border-box",
      border: "2px solid #7c5cff",
      background: "rgba(124, 92, 255, 0.12)",
      zIndex: "2147483646",
      transition: "left 60ms linear, top 60ms linear, width 60ms linear, height 60ms linear",
    });

    const panel = document.createElement("div");
    panel.dataset[UI_ATTRIBUTE] = "";
    panel.setAttribute("role", "status");
    panel.setAttribute("aria-live", "polite");
    Object.assign(panel.style, {
      position: "fixed",
      left: "50%",
      bottom: "20px",
      transform: "translateX(-50%)",
      width: "min(720px, calc(100vw - 32px))",
      boxSizing: "border-box",
      display: "flex",
      flexDirection: "column",
      padding: "12px 14px",
      border: "1px solid rgba(255,255,255,.16)",
      borderRadius: "12px",
      background: "rgba(20, 20, 24, .96)",
      boxShadow: "0 12px 40px rgba(0,0,0,.35)",
      color: "#f7f7fb",
      font: "13px/1.45 ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
      letterSpacing: "normal",
      textAlign: "left",
      pointerEvents: "auto",
      userSelect: "text",
      cursor: "text",
      zIndex: "2147483647",
    });

    const grip = document.createElement("div");
    grip.dataset[UI_ATTRIBUTE] = "";
    grip.dataset[DRAG_ATTRIBUTE] = "";
    grip.setAttribute("aria-hidden", "true");
    Object.assign(grip.style, {
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      height: "14px",
      marginBottom: "4px",
      cursor: "grab",
      userSelect: "none",
    });

    const gripBar = document.createElement("div");
    gripBar.dataset[UI_ATTRIBUTE] = "";
    Object.assign(gripBar.style, {
      width: "38px",
      height: "4px",
      borderRadius: "999px",
      background: "rgba(255,255,255,.28)",
      // Transparent to the pointer so the whole grip row is the drag target.
      pointerEvents: "none",
    });
    grip.append(gripBar);

    const body = document.createElement("div");
    body.dataset[UI_ATTRIBUTE] = "";
    // Rows scroll inside the panel once it is resized shorter than its content.
    Object.assign(body.style, { flex: "1", minHeight: "0", overflow: "auto" });

    const resizeHandle = document.createElement("div");
    resizeHandle.dataset[UI_ATTRIBUTE] = "";
    resizeHandle.setAttribute("aria-hidden", "true");
    Object.assign(resizeHandle.style, {
      position: "absolute",
      right: "3px",
      bottom: "3px",
      width: "14px",
      height: "14px",
      borderBottomRightRadius: "10px",
      backgroundImage: "repeating-linear-gradient(315deg, rgba(255,255,255,.45) 0 1.5px, transparent 1.5px 4px)",
      cursor: "nwse-resize",
      userSelect: "none",
    });

    panel.append(grip, body, resizeHandle);

    document.documentElement.append(outline, panel);
    state.outline = outline;
    state.panel = panel;
    state.grip = grip;
    state.body = body;
    state.resizeHandle = resizeHandle;
    applyLayout();
  }

  // Position first: the size clamp measures the space left from the panel's own left and top edges.
  function applyLayout() {
    if (state.panelOffset) movePanel(state.panelOffset.left, state.panelOffset.top);
    if (state.panelSize) resizePanel(state.panelSize.width, state.panelSize.height);
  }

  function removeUi() {
    state.outline?.remove();
    state.panel?.remove();
    state.outline = null;
    state.panel = null;
    state.grip = null;
    state.body = null;
    state.resizeHandle = null;
  }

  function panelLine(label, value, { color = "#d9d4ff", swatch = null } = {}) {
    const row = document.createElement("div");
    row.dataset[UI_ATTRIBUTE] = "";
    const name = document.createElement("span");
    name.dataset[UI_ATTRIBUTE] = "";
    // Labels are chrome rather than content, so they double as drag handles.
    name.dataset[DRAG_ATTRIBUTE] = "";
    Object.assign(name.style, { color: "#8d879e", cursor: "grab", userSelect: "none" });
    name.textContent = `${label.padEnd(11)} `;
    const content = document.createElement("span");
    content.dataset[UI_ATTRIBUTE] = "";
    content.style.color = color;
    content.style.overflowWrap = "anywhere";
    content.textContent = value || "—";
    row.append(name, ...(swatch ? [swatch] : []), content);
    return row;
  }

  function colorSwatch(value) {
    const swatch = document.createElement("span");
    swatch.dataset[UI_ATTRIBUTE] = "";
    swatch.setAttribute("aria-hidden", "true");
    Object.assign(swatch.style, {
      display: "inline-block",
      width: "10px",
      height: "10px",
      marginRight: "6px",
      verticalAlign: "-1px",
      borderRadius: "2px",
      border: "1px solid rgba(255,255,255,.35)",
      // A checkerboard sits under the sampled color so translucent values read as translucent.
      backgroundImage: `linear-gradient(${value}, ${value}), conic-gradient(#ffffff 0 25%, #9b96a8 0 50%, #ffffff 0 75%, #9b96a8 0)`,
      backgroundSize: "auto, 6px 6px",
    });
    return swatch;
  }

  function panelColorLine(label, value) {
    return panelLine(label, formatColor(value), { swatch: colorSwatch(value) });
  }

  function boxValues(style, property) {
    const values = ["Top", "Right", "Bottom", "Left"].map((side) => style[`${property}${side}`]);
    if (values.every((value) => value === values[0])) return values[0];
    if (values[0] === values[2] && values[1] === values[3]) return `${values[0]} ${values[1]}`;
    if (values[1] === values[3]) return `${values[0]} ${values[1]} ${values[2]}`;
    return values.join(" ");
  }

  function renderPanel() {
    if (!state.body) return;
    clearTimeout(state.toastTimer);
    state.toastTimer = null;
    state.body.replaceChildren();
    state.toastLine = null;
    if (!state.selected) {
      state.body.append(panelLine("SCOUT", "Move the pointer over an element"));
      return;
    }

    const selector = buildSelector(state.selected);
    const id = state.selected.id ? `#${state.selected.id}` : "—";
    const classes = Array.from(state.selected.classList, (name) => `.${name}`).join(" ") || "—";
    const style = getComputedStyle(state.selected);
    state.body.append(
      panelLine("ELEMENT", describeElement(state.selected), { color: "#ffffff" }),
      panelLine("SELECTOR", selector),
      panelLine("ID", id),
      panelLine("CLASSES", classes),
      panelColorLine("COLOR", style.color),
      panelColorLine("BACKGROUND", style.backgroundColor),
      panelLine("PADDING", boxValues(style, "padding")),
      panelLine("MARGIN", boxValues(style, "margin")),
      panelLine("LINE HEIGHT", style.lineHeight),
      panelLine(
        "KEYS",
        "↑ parent  ↓ child  ←/→ sibling  Enter/click selector  I id  C classes  Esc exit  drag bar/label to move  corner to resize",
        { color: "#a8a2b8" },
      ),
    );
  }

  function select(element) {
    if (!element || isOwned(element) || !state.active) return;
    state.selected = element;
    const rect = element.getBoundingClientRect();
    Object.assign(state.outline.style, {
      display: "block",
      left: `${rect.left}px`,
      top: `${rect.top}px`,
      width: `${rect.width}px`,
      height: `${rect.height}px`,
    });
    renderPanel();
  }

  function updateFromPointer() {
    state.rafId = null;
    if (!state.active || state.locked || !state.lastPointer) return;
    const { clientX, clientY } = state.lastPointer;
    select(document.elementFromPoint(clientX, clientY));
  }

  function movePanel(left, top) {
    if (!state.panel) return;
    const rect = state.panel.getBoundingClientRect();
    state.panelOffset = {
      left: clamp(left, 0, window.innerWidth - rect.width),
      top: clamp(top, 0, window.innerHeight - rect.height),
    };
    Object.assign(state.panel.style, {
      left: `${state.panelOffset.left}px`,
      top: `${state.panelOffset.top}px`,
      bottom: "auto",
      transform: "none",
    });
  }

  function resizePanel(width, height) {
    if (!state.panel) return;
    const rect = state.panel.getBoundingClientRect();
    state.panelSize = {
      width: clamp(width, MIN_PANEL_WIDTH, window.innerWidth - rect.left),
      height: clamp(height, MIN_PANEL_HEIGHT, window.innerHeight - rect.top),
    };
    state.panel.style.width = `${state.panelSize.width}px`;
    state.panel.style.height = `${state.panelSize.height}px`;
  }

  function isDragHandle(target) {
    if (target === state.panel || target === state.body) return true;
    return Boolean(target?.dataset && DRAG_ATTRIBUTE in target.dataset);
  }

  function onPointerDown(event) {
    if (!state.active || !state.panel || event.button !== 0) return;
    const resizing = event.target === state.resizeHandle;
    if (!resizing && !isDragHandle(event.target)) return;
    const rect = state.panel.getBoundingClientRect();
    if (resizing) {
      // Anchoring the top left corner first keeps the panel from growing away from the pointer.
      movePanel(rect.left, rect.top);
      state.resize = { pointerX: event.clientX, pointerY: event.clientY, width: rect.width, height: rect.height };
    } else {
      state.drag = { offsetLeft: event.clientX - rect.left, offsetTop: event.clientY - rect.top };
      if (state.grip) state.grip.style.cursor = "grabbing";
    }
    // Capture keeps the gesture alive when the pointer outruns the panel.
    state.panel.setPointerCapture?.(event.pointerId);
    event.preventDefault();
    event.stopPropagation();
  }

  function onPointerUp() {
    if (!state.drag && !state.resize) return;
    state.drag = null;
    state.resize = null;
    if (state.grip) state.grip.style.cursor = "grab";
    saveLayout({ offset: state.panelOffset, size: state.panelSize });
  }

  function onPointerMove(event) {
    if (state.resize) {
      resizePanel(
        state.resize.width + event.clientX - state.resize.pointerX,
        state.resize.height + event.clientY - state.resize.pointerY,
      );
      return;
    }
    if (state.drag) {
      movePanel(event.clientX - state.drag.offsetLeft, event.clientY - state.drag.offsetTop);
      return;
    }
    if (state.locked || isOwned(event.target)) return;
    state.lastPointer = event;
    if (!state.rafId) state.rafId = requestAnimationFrame(updateFromPointer);
  }

  function legacyCopy(text) {
    const textarea = document.createElement("textarea");
    textarea.dataset[UI_ATTRIBUTE] = "";
    textarea.value = text;
    textarea.setAttribute("readonly", "");
    Object.assign(textarea.style, { position: "fixed", left: "-9999px", opacity: "0" });
    document.documentElement.append(textarea);
    textarea.select();
    const copied = document.execCommand("copy");
    textarea.remove();
    return copied;
  }

  function copyText(text, label) {
    if (!text) return;
    void writeClipboard(text, {
      clipboardWrite: navigator.clipboard?.writeText ? (value) => navigator.clipboard.writeText(value) : null,
      legacyCopy,
    }).then((copied) => {
      if (!state.panel) return;
      clearTimeout(state.toastTimer);
      state.toastLine?.remove();
      state.toastLine = panelLine("COPIED", copied ? `${label}: ${text}` : "Clipboard access was blocked", { color: "#78e6a5" });
      state.body.append(state.toastLine);
      state.toastTimer = setTimeout(() => {
        state.toastLine?.remove();
        state.toastLine = null;
      }, 1500);
    });
  }

  function activate() {
    if (state.active) return;
    state.active = true;
    state.originalCursor = document.documentElement.style.cursor;
    createUi();
    document.addEventListener("pointermove", onPointerMove, true);
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("pointerup", onPointerUp, true);
    document.addEventListener("pointercancel", onPointerUp, true);
    document.documentElement.style.cursor = "crosshair";
    renderPanel();
  }

  function deactivate() {
    if (!state.active) return;
    state.active = false;
    state.selected = null;
    state.locked = false;
    state.lastPointer = null;
    state.drag = null;
    state.resize = null;
    document.removeEventListener("pointermove", onPointerMove, true);
    document.removeEventListener("pointerdown", onPointerDown, true);
    document.removeEventListener("pointerup", onPointerUp, true);
    document.removeEventListener("pointercancel", onPointerUp, true);
    document.documentElement.style.cursor = state.originalCursor;
    if (state.rafId) cancelAnimationFrame(state.rafId);
    clearTimeout(state.toastTimer);
    removeUi();
  }

  function toggle() {
    if (state.active) deactivate();
    else activate();
  }

  function onKeyDown(event) {
    if (!state.active) return;
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopImmediatePropagation();
      deactivate();
      return;
    }
    if (event.metaKey || event.ctrlKey || event.altKey) return;

    const direction = { ArrowUp: "up", ArrowDown: "down", ArrowLeft: "left", ArrowRight: "right" }[event.key];
    if (direction) {
      event.preventDefault();
      event.stopImmediatePropagation();
      const next = navigate(state.selected, direction);
      if (next) {
        select(next);
        state.locked = true;
      }
      return;
    }

    if (event.key === "Enter" && state.selected) {
      event.preventDefault();
      state.locked = true;
      copyText(buildSelector(state.selected), "selector");
    } else if (event.key.toLowerCase() === "i" && state.selected) {
      event.preventDefault();
      state.locked = true;
      copyText(state.selected.id ? `#${state.selected.id}` : "", "id");
    } else if (event.key.toLowerCase() === "c" && state.selected) {
      event.preventDefault();
      state.locked = true;
      copyText(Array.from(state.selected.classList, (name) => `.${name}`).join(""), "classes");
    }
  }

  function onClick(event) {
    if (!state.active || !event.target?.tagName || isOwned(event.target)) return;
    select(event.target);
    state.locked = true;
    event.preventDefault();
    event.stopImmediatePropagation();
    copyText(buildSelector(state.selected), "selector");
  }

  function refreshSelection() {
    if (state.active && state.selected) select(state.selected);
  }

  function onResize() {
    // Re-clamp so a moved or resized panel cannot end up outside a shrunken viewport. Only a
    // gesture saves a layout, so a viewport-driven fit never overwrites the remembered one.
    applyLayout();
    refreshSelection();
  }

  document.addEventListener("keydown", onKeyDown, true);
  document.addEventListener("click", onClick, true);
  window.addEventListener("scroll", refreshSelection, true);
  window.addEventListener("resize", onResize);
  globalThis.__SELECTOR_SCOUT_CONTROLLER__ = { toggle };
  activate();

  void loadLayout().then((layout) => {
    // Reading storage is asynchronous, so a gesture that lands first wins over the stored layout.
    if (!layout || state.panelOffset || state.panelSize) return;
    state.panelOffset = finiteBox(layout.offset, ["left", "top"]);
    state.panelSize = finiteBox(layout.size, ["width", "height"]);
    applyLayout();
  });
})();

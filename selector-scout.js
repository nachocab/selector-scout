(function () {
  "use strict";

  const UI_ATTRIBUTE = "selectorScoutUi";

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
    globalThis.__SELECTOR_SCOUT_TEST_EXPORTS__ = { buildSelector, describeElement, navigate, writeClipboard };
    return;
  }

  if (globalThis.__SELECTOR_SCOUT_CONTROLLER__) {
    globalThis.__SELECTOR_SCOUT_CONTROLLER__.toggle();
    return;
  }

  const state = {
    active: false,
    selected: null,
    rafId: null,
    lastPointer: null,
    outline: null,
    panel: null,
    toastTimer: null,
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
      padding: "12px 14px",
      border: "1px solid rgba(255,255,255,.16)",
      borderRadius: "12px",
      background: "rgba(20, 20, 24, .96)",
      boxShadow: "0 12px 40px rgba(0,0,0,.35)",
      color: "#f7f7fb",
      font: "13px/1.45 ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
      letterSpacing: "normal",
      textAlign: "left",
      pointerEvents: "none",
      zIndex: "2147483647",
    });

    document.documentElement.append(outline, panel);
    state.outline = outline;
    state.panel = panel;
  }

  function removeUi() {
    state.outline?.remove();
    state.panel?.remove();
    state.outline = null;
    state.panel = null;
  }

  function panelLine(label, value, color = "#d9d4ff") {
    const row = document.createElement("div");
    row.dataset[UI_ATTRIBUTE] = "";
    const name = document.createElement("span");
    name.dataset[UI_ATTRIBUTE] = "";
    name.style.color = "#8d879e";
    name.textContent = `${label.padEnd(9)} `;
    const content = document.createElement("span");
    content.dataset[UI_ATTRIBUTE] = "";
    content.style.color = color;
    content.style.overflowWrap = "anywhere";
    content.textContent = value || "—";
    row.append(name, content);
    return row;
  }

  function renderPanel(message = "") {
    if (!state.panel) return;
    state.panel.replaceChildren();
    if (!state.selected) {
      state.panel.append(panelLine("SCOUT", "Move the pointer over an element"));
      return;
    }

    const selector = buildSelector(state.selected);
    const id = state.selected.id ? `#${state.selected.id}` : "—";
    const classes = Array.from(state.selected.classList, (name) => `.${name}`).join(" ") || "—";
    state.panel.append(
      panelLine("ELEMENT", describeElement(state.selected), "#ffffff"),
      panelLine("SELECTOR", selector),
      panelLine("ID", id),
      panelLine("CLASSES", classes),
      panelLine("KEYS", "↑ parent  ↓ child  ←/→ sibling  Enter/click selector  I id  C classes  Esc exit", "#a8a2b8"),
    );
    if (message) state.panel.append(panelLine("COPIED", message, "#78e6a5"));
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
    if (!state.active || !state.lastPointer) return;
    const { clientX, clientY } = state.lastPointer;
    select(document.elementFromPoint(clientX, clientY));
  }

  function onPointerMove(event) {
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
      renderPanel(copied ? `${label}: ${text}` : "Clipboard access was blocked");
      clearTimeout(state.toastTimer);
      state.toastTimer = setTimeout(() => renderPanel(), 1500);
    });
  }

  function activate() {
    if (state.active) return;
    state.active = true;
    state.originalCursor = document.documentElement.style.cursor;
    createUi();
    document.addEventListener("pointermove", onPointerMove, true);
    document.documentElement.style.cursor = "crosshair";
    renderPanel();
  }

  function deactivate() {
    if (!state.active) return;
    state.active = false;
    state.selected = null;
    state.lastPointer = null;
    document.removeEventListener("pointermove", onPointerMove, true);
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

    const direction = { ArrowUp: "up", ArrowDown: "down", ArrowLeft: "left", ArrowRight: "right" }[event.key];
    if (direction) {
      event.preventDefault();
      event.stopImmediatePropagation();
      const next = navigate(state.selected, direction);
      if (next) select(next);
      return;
    }

    if (event.key === "Escape") {
      event.preventDefault();
      deactivate();
    } else if (event.key === "Enter" && state.selected) {
      event.preventDefault();
      copyText(buildSelector(state.selected), "selector");
    } else if (event.key.toLowerCase() === "i" && state.selected) {
      event.preventDefault();
      copyText(state.selected.id ? `#${state.selected.id}` : "", "id");
    } else if (event.key.toLowerCase() === "c" && state.selected) {
      event.preventDefault();
      copyText(Array.from(state.selected.classList, (name) => `.${name}`).join(""), "classes");
    }
  }

  function onClick(event) {
    if (!state.active || !state.selected) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    copyText(buildSelector(state.selected), "selector");
  }

  function refreshSelection() {
    if (state.active && state.selected) select(state.selected);
  }

  document.addEventListener("keydown", onKeyDown, true);
  document.addEventListener("click", onClick, true);
  window.addEventListener("scroll", refreshSelection, true);
  window.addEventListener("resize", refreshSelection);
  globalThis.__SELECTOR_SCOUT_CONTROLLER__ = { toggle };
  activate();
})();

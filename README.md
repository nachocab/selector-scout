# Selector Scout

Selector Scout is a keyboard-driven local browser extension for inspecting page elements without opening DevTools. It runs in Brave, Chrome, and other Chromium browsers.

## Controls

- `⌘⇧S` on macOS or `Ctrl+Shift+S` elsewhere: turn inspection mode on or off
- Move the pointer: preview the element underneath it until a selection is pinned
- `↑`: select the parent
- `↓`: select the first child
- `←` / `→`: select the previous or next sibling
- `Enter` or click: copy the generated CSS selector and pin that element; click another page element to select it instead
- `I`: copy the selected element ID, including `#`
- `C`: copy all classes as a compact CSS class selector
- `Esc`: leave inspection mode
- Drag the panel's grab bar, a row label, or its padding: move the panel out of the way
- Drag the panel's bottom-right corner: resize it

The floating panel shows the element name, ID, classes, generated CSS selector, computed text and background colors, padding, margin, and line height. Each color is drawn as a swatch next to its hex value, over a checkerboard so translucent colors read as translucent. You can select and copy text directly from the panel. While inspection mode is active, clicks on page elements copy selectors instead of activating the page.

The panel starts at the bottom of the viewport. Drag it anywhere to uncover content it overlaps, and drag its bottom-right corner to resize it down to 220×72 pixels; the rows scroll once the panel is shorter than its content. Resizing holds the top-left corner still, and both gestures keep the panel inside the viewport, including across a window resize. The panel keeps its position and size until the page reloads. Row values remain selectable text, so only the grab bar, the labels, and the panel padding start a drag.

## Install in Brave

1. Open `brave://extensions`.
2. Turn on **Developer mode**.
3. Click **Load unpacked** and select this repository folder.
4. Pin Selector Scout if you want a toolbar button as well as the shortcut.

You only need to load the extension once. After changing its code, click its reload button on `brave://extensions` (or ask Codex to open that page for you). No Apple Events setting or Tampermonkey installation is needed.

To change the shortcut, open `brave://extensions/shortcuts` and edit **Activate the extension** under Selector Scout. If the default shortcut conflicts with another extension, Chromium may leave it unassigned.

Selector Scout requests only `activeTab` and `scripting`. It receives temporary access to the current page when you click its toolbar button or invoke its shortcut; it does not request persistent access to every website. Browser-internal pages such as `brave://settings` cannot be inspected.

## Develop

Run `npm test` for focused logic tests or `npm run check` for syntax validation plus the full test suite. The fixture in [`fixture/index.html`](./fixture/index.html) supports browser-level verification.

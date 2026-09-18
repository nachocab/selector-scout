# Selector Scout

Selector Scout is a keyboard-driven Tampermonkey userscript for inspecting page elements without opening DevTools.

## Controls

- `⌘⌥S`: turn inspection mode on or off
- Move the pointer: select the element underneath it
- `↑`: select the parent
- `↓`: select the first child
- `←` / `→`: select the previous or next sibling
- `Enter` or click: copy the generated CSS selector
- `I`: copy the selected element ID, including `#`
- `C`: copy all classes as a compact CSS class selector
- `Esc`: leave inspection mode

The floating panel shows the element name, ID, classes, and a generated CSS selector. While inspection mode is active, clicks copy selectors instead of activating the page.

## Install

1. Install and enable Tampermonkey in Brave.
2. Open the Tampermonkey dashboard and choose **Create a new script**.
3. Replace the editor contents with [`selector-scout.user.js`](./selector-scout.user.js).
4. Save with `⌘S`.

The broad `*://*/*` match is intentional because Selector Scout is a general inspection tool. Brave internal pages such as `brave://settings` do not allow userscripts.

## Develop

Run `npm test` for focused logic tests or `npm run check` for syntax validation plus the full test suite. The fixture in [`fixture/index.html`](./fixture/index.html) supports browser-level verification.

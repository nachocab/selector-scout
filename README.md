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

### Fast Brave injection loop

The repository includes [`tools/brave_osa.py`](./tools/brave_osa.py) for injecting the latest local userscript into an ordinary tab in the running Brave profile. This avoids reopening Tampermonkey during development.

Before every `eval` or `inject` command, enable **Brave → View → Developer → Allow JavaScript from Apple Events**. Disable it immediately afterward. The helper prints both reminders every time, including after a failed command.

List open tabs:

```sh
UV_CACHE_DIR=/tmp/uv-cache uv run python tools/brave_osa.py tabs
```

Reload a matching tab and inject the current script:

```sh
UV_CACHE_DIR=/tmp/uv-cache uv run python tools/brave_osa.py inject --match example.com --file selector-scout.user.js
```

Direct injection is temporary and disappears on the next reload. It runs in Brave's AppleScript JavaScript world rather than Tampermonkey's sandbox, so Tampermonkey-only APIs may not be present. Selector Scout includes a browser clipboard fallback for this development mode.

For the one-time persistent installation, open Tampermonkey's installer from a local server:

```sh
UV_CACHE_DIR=/tmp/uv-cache uv run python tools/brave_osa.py install --file selector-scout.user.js
```

Click **Install** in the protected Tampermonkey page, then stop the temporary server:

```sh
UV_CACHE_DIR=/tmp/uv-cache uv run python tools/brave_osa.py stop
```

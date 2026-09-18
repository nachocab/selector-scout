#!/usr/bin/env python3
"""Develop userscripts in a running Brave profile through AppleScript.

JavaScript commands require Brave > View > Developer > Allow JavaScript from
Apple Events. Keep that setting enabled only while a command is running.

Examples:
    uv run python tools/brave_osa.py tabs
    uv run python tools/brave_osa.py inject --match example.com --file selector-scout.user.js
    uv run python tools/brave_osa.py eval --match example.com --expr 'document.title'
    uv run python tools/brave_osa.py install --file selector-scout.user.js
"""

import argparse
import base64
import json
import os
import pathlib
import signal
import subprocess
import sys
import time
import urllib.error
import urllib.request
from collections.abc import Callable
from typing import TypeVar


BROWSER_APP = "Brave Browser"
DELIMITER = "|~|"
ENABLE_REMINDER = (
    "ENABLE first: Brave > View > Developer > Allow JavaScript from Apple Events."
)
DISABLE_REMINDER = (
    "DISABLE now: Brave > View > Developer > Allow JavaScript from Apple Events."
)
Result = TypeVar("Result")


def with_javascript_reminders(operation: Callable[[], Result]) -> Result:
    """Bracket a JavaScript operation with the requested security reminders."""
    print(f"\n⚠️  {ENABLE_REMINDER}", file=sys.stderr)
    try:
        return operation()
    finally:
        print(f"⚠️  {DISABLE_REMINDER}\n", file=sys.stderr)


def osa(script: str) -> str:
    """Run AppleScript and return stdout, raising a readable error on failure."""
    process = subprocess.run(
        ["osascript", "-"],
        input=script,
        capture_output=True,
        text=True,
        check=False,
    )
    if process.returncode != 0:
        message = process.stderr.strip()
        if "Apple Events" in message or "JavaScript" in message:
            message = f"{message}\n{ENABLE_REMINDER}"
        raise RuntimeError(f"osascript failed: {message}")
    return process.stdout.rstrip("\n")


def aps(value: str) -> str:
    """Quote a Python string as an AppleScript string literal."""
    return '"' + value.replace("\\", "\\\\").replace('"', '\\"') + '"'


def list_tabs() -> list[dict]:
    """Return every Brave tab with stable window IDs and per-window indices."""
    raw = osa(
        f"""
        tell application "{BROWSER_APP}"
          set output to ""
          repeat with browserWindow in windows
            set tabIndex to 0
            repeat with browserTab in tabs of browserWindow
              set tabIndex to tabIndex + 1
              set output to output & (id of browserWindow as string) & "{DELIMITER}" & (id of browserTab as string) & "{DELIMITER}" & (tabIndex as string) & "{DELIMITER}" & (title of browserTab) & "{DELIMITER}" & (URL of browserTab) & linefeed
            end repeat
          end repeat
          return output
        end tell
        """
    )
    tabs = []
    for line in raw.splitlines():
        parts = line.split(DELIMITER)
        if len(parts) < 5:
            continue
        window, tab_id, index, title = parts[:4]
        tabs.append(
            {
                "window": window,
                "id": tab_id,
                "index": int(index),
                "title": title,
                "url": DELIMITER.join(parts[4:]),
            }
        )
    return tabs


def find_tab(match: str) -> dict:
    """Find exactly one tab whose URL or title contains match."""
    needle = match.casefold()
    matches = [
        tab
        for tab in list_tabs()
        if needle in tab["url"].casefold() or needle in tab["title"].casefold()
    ]
    if not matches:
        raise RuntimeError(f"No Brave tab matches {match!r}. Run `tabs` to list them.")
    if len(matches) > 1:
        listing = "\n".join(f"  {tab['title']}: {tab['url'][:100]}" for tab in matches)
        raise RuntimeError(f"{len(matches)} Brave tabs match {match!r}; narrow it:\n{listing}")
    return matches[0]


def run_js_in_tab(tab: dict, source: str) -> str:
    """Evaluate JavaScript in a known Brave tab and serialize its result."""
    payload = base64.b64encode(source.encode("utf-8")).decode("ascii")
    javascript = (
        "(function(){try{"
        f"var r=eval(decodeURIComponent(escape(atob({aps(payload)}))));"
        "return (typeof r==='string')?r:JSON.stringify(r);"
        "}catch(e){return 'ERROR: '+((e&&e.stack)||e);}})()"
    )
    return osa(
        f"""
        tell application "{BROWSER_APP}"
          set w to first window whose id is {tab["window"]}
          set t to first tab of w whose id is {aps(tab["id"])}
          return execute t javascript {aps(javascript)}
        end tell
        """
    )


def run_js(match: str, source: str) -> str:
    return run_js_in_tab(find_tab(match), source)


def reload_tab(tab: dict) -> None:
    osa(
        f"""
        tell application "{BROWSER_APP}"
          set w to first window whose id is {tab["window"]}
          set t to first tab of w whose id is {aps(tab["id"])}
          reload t
        end tell
        """
    )


def wait_until_loaded(tab: dict, timeout: float = 15) -> None:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        loading = osa(
            f"""
            tell application "{BROWSER_APP}"
              set w to first window whose id is {tab["window"]}
              set t to first tab of w whose id is {aps(tab["id"])}
              return loading of t
            end tell
            """
        )
        if loading.strip().lower() == "false":
            return
        time.sleep(0.1)
    raise RuntimeError("Timed out waiting for the Brave tab to reload.")


def inject(match: str, path: pathlib.Path, reload_first: bool = True) -> str:
    tab = find_tab(match)
    if reload_first:
        reload_tab(tab)
        wait_until_loaded(tab)
    body = path.read_text(encoding="utf-8")
    return run_js_in_tab(tab, f"{body}\n;'injected: '+document.visibilityState")


def open_tab(url: str) -> None:
    osa(
        f"""
        tell application "{BROWSER_APP}"
          set w to first window
          make new tab at end of tabs of w with properties {{URL:{aps(url)}}}
        end tell
        """
    )


def server_pid_path(port: int) -> pathlib.Path:
    return pathlib.Path(f"/tmp/selector_scout_server_{port}.pid")


def serve_directory(directory: pathlib.Path, port: int) -> int:
    log_path = pathlib.Path(f"/tmp/selector_scout_server_{port}.log")
    log = log_path.open("wb")
    process = subprocess.Popen(
        [
            sys.executable,
            "-m",
            "http.server",
            str(port),
            "--bind",
            "127.0.0.1",
            "--directory",
            str(directory),
        ],
        stdout=log,
        stderr=subprocess.STDOUT,
        start_new_session=True,
    )
    server_pid_path(port).write_text(str(process.pid), encoding="ascii")
    for _ in range(40):
        try:
            urllib.request.urlopen(f"http://127.0.0.1:{port}/", timeout=1).read(1)
            return process.pid
        except urllib.error.HTTPError:
            return process.pid
        except OSError:
            time.sleep(0.15)
    raise RuntimeError(f"Server on port {port} did not start; see {log_path}.")


def stop_server(port: int) -> bool:
    pid_path = server_pid_path(port)
    if not pid_path.exists():
        return False
    pid = int(pid_path.read_text(encoding="ascii"))
    try:
        os.kill(pid, signal.SIGTERM)
    except ProcessLookupError:
        pass
    pid_path.unlink(missing_ok=True)
    return True


def source_from_args(args: argparse.Namespace) -> str:
    if args.file:
        return pathlib.Path(args.file).expanduser().read_text(encoding="utf-8")
    if args.expr:
        return args.expr
    raise RuntimeError("Provide either --expr or --file.")


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    commands = parser.add_subparsers(dest="command", required=True)

    commands.add_parser("tabs", help="List every open Brave tab.")

    evaluate = commands.add_parser("eval", help="Evaluate JavaScript in one tab.")
    evaluate.add_argument("--match", required=True)
    evaluate.add_argument("--expr")
    evaluate.add_argument("--file")

    inject_parser = commands.add_parser("inject", help="Reload and inject a userscript.")
    inject_parser.add_argument("--match", required=True)
    inject_parser.add_argument("--file", required=True)
    inject_parser.add_argument("--reload", action=argparse.BooleanOptionalAction, default=True)

    reload_parser = commands.add_parser("reload", help="Reload one matching tab.")
    reload_parser.add_argument("--match", required=True)

    install = commands.add_parser("install", help="Open Tampermonkey's installer.")
    install.add_argument("--file", required=True)
    install.add_argument("--port", type=int, default=8787)

    stop = commands.add_parser("stop", help="Stop the local installation server.")
    stop.add_argument("--port", type=int, default=8787)
    return parser


def main() -> None:
    args = build_parser().parse_args()
    if args.command == "tabs":
        for tab in list_tabs():
            print(f"{tab['window']}\t{tab['index']}\t{tab['title'][:60]}\t{tab['url'][:110]}")
    elif args.command == "eval":
        result = with_javascript_reminders(
            lambda: run_js(args.match, source_from_args(args))
        )
        print(result)
    elif args.command == "inject":
        script_path = pathlib.Path(args.file).expanduser().resolve()
        result = with_javascript_reminders(
            lambda: inject(args.match, script_path, args.reload)
        )
        print(result)
    elif args.command == "reload":
        tab = find_tab(args.match)
        reload_tab(tab)
        print(f"Reloaded {tab['url'][:110]}")
    elif args.command == "install":
        script_path = pathlib.Path(args.file).expanduser().resolve()
        if not script_path.is_file():
            raise RuntimeError(f"No such file: {script_path}")
        serve_directory(script_path.parent, args.port)
        url = f"http://127.0.0.1:{args.port}/{script_path.name}"
        open_tab(url)
        print(
            json.dumps(
                {
                    "served": url,
                    "next": "Click Install once in Tampermonkey's protected page.",
                    "stop": f"uv run python tools/brave_osa.py stop --port {args.port}",
                },
                indent=2,
            )
        )
    elif args.command == "stop":
        print("Stopped." if stop_server(args.port) else "No recorded server was running.")


if __name__ == "__main__":
    try:
        main()
    except (OSError, RuntimeError) as error:
        raise SystemExit(str(error)) from error

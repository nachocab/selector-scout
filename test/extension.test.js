const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const root = path.join(__dirname, "..");

test("manifest uses action-scoped permissions and configurable shortcuts", () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, "manifest.json"), "utf8"));

  assert.equal(manifest.manifest_version, 3);
  assert.deepEqual(manifest.permissions, ["activeTab", "scripting"]);
  assert.equal(manifest.host_permissions, undefined);
  assert.equal(manifest.background.service_worker, "service-worker.js");
  assert.equal(manifest.commands._execute_action.suggested_key.mac, "Command+Option+S");
  assert.equal(manifest.commands._execute_action.suggested_key.default, "Ctrl+Shift+S");
});

test("clicking the extension action injects Selector Scout into that tab", async () => {
  let actionListener;
  let injection;
  const chrome = {
    action: {
      onClicked: { addListener: (listener) => (actionListener = listener) },
      setBadgeText: async () => {},
      setTitle: async () => {},
    },
    scripting: {
      executeScript: async (details) => (injection = details),
    },
  };

  const source = fs.readFileSync(path.join(root, "service-worker.js"), "utf8");
  vm.runInNewContext(source, { chrome, console });
  await actionListener({ id: 42 });

  assert.deepEqual(JSON.parse(JSON.stringify(injection)), { target: { tabId: 42 }, files: ["selector-scout.js"] });
});

test("the action ignores tabs without an injectable id", async () => {
  let actionListener;
  let injections = 0;
  const chrome = {
    action: {
      onClicked: { addListener: (listener) => (actionListener = listener) },
      setBadgeText: async () => {},
      setTitle: async () => {},
    },
    scripting: {
      executeScript: async () => (injections += 1),
    },
  };

  const source = fs.readFileSync(path.join(root, "service-worker.js"), "utf8");
  vm.runInNewContext(source, { chrome, console });
  await actionListener({});

  assert.equal(injections, 0);
});

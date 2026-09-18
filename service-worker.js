async function toggleSelectorScout(tab) {
  if (!Number.isInteger(tab?.id)) return;

  try {
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ["selector-scout.js"],
    });
    await chrome.action.setBadgeText({ tabId: tab.id, text: "" });
    await chrome.action.setTitle({ tabId: tab.id, title: "Toggle Selector Scout" });
  } catch (error) {
    await chrome.action.setBadgeText({ tabId: tab.id, text: "!" });
    await chrome.action.setTitle({ tabId: tab.id, title: "Selector Scout cannot inspect this page" });
    console.warn("Selector Scout could not be injected into the active tab.", error);
  }
}

chrome.action.onClicked.addListener(toggleSelectorScout);

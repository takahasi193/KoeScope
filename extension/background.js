const MENU_ID = "dl-voice-search-selection";

function normalizeKeyword(value) {
  return String(value ?? "").trim().replace(/\s+/g, " ");
}

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: MENU_ID,
    title: '用 DL Voice Search 搜索 "%s"',
    contexts: ["selection"],
  });
});

chrome.contextMenus.onClicked.addListener(async (info) => {
  if (info.menuItemId !== MENU_ID) return;

  const keyword = normalizeKeyword(info.selectionText);
  if (!keyword) return;

  await chrome.storage.local.set({
    pendingKeyword: keyword,
    pendingKeywordAt: Date.now(),
  });

  try {
    await chrome.action.openPopup();
  } catch {
    await chrome.action.setBadgeText({ text: "1" });
    await chrome.action.setBadgeBackgroundColor({ color: "#08756f" });
  }
});

chrome.action.onClicked.addListener(async () => {
  await chrome.action.setBadgeText({ text: "" });
});

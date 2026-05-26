// Page Anchors - Background Service Worker
// Injects the content script programmatically to support sites where
// manifest-based injection doesn't work (some mirror/proxy sites, etc.)

const TARGET_URLS = ['http://*/*', 'https://*/*'];

async function injectContentScript(tabId) {
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ['content-script.js'],
    });
  } catch (err) {
    // Some pages (chrome://, edge://, error pages) don't allow injection
  }
}

// Inject when a tab finishes loading
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete' && tab.url && /^https?:\/\//.test(tab.url)) {
    injectContentScript(tabId);
  }
});

// Inject into already-open tabs when the extension starts
chrome.runtime.onInstalled.addListener(() => {
  chrome.tabs.query({ url: TARGET_URLS }, (tabs) => {
    for (const tab of tabs) {
      injectContentScript(tab.id);
    }
  });
});

// Page Anchors - Background Service Worker
// Injects the content script programmatically to support sites where
// manifest-based injection doesn't work (some mirror/proxy sites, etc.)

const TARGET_URLS = ['http://*/*', 'https://*/*'];

async function injectContentScript(tabId) {
  try {
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      files: ['content-script.js'],
    });
    console.log('[Page Anchors] Injection OK for tab', tabId);
  } catch (err) {
    console.log('[Page Anchors] Injection FAILED for tab', tabId, err.message);
  }
}

// Inject when a tab finishes loading
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete' && tab.url && /^https?:\/\//.test(tab.url)) {
    console.log('[Page Anchors] Tab updated:', tabId, tab.url);
    injectContentScript(tabId);
  }
});

// Inject into already-open tabs when the extension starts
chrome.runtime.onInstalled.addListener(() => {
  console.log('[Page Anchors] Extension installed/updated');
  chrome.tabs.query({ url: TARGET_URLS }, (tabs) => {
    console.log('[Page Anchors] Found', tabs.length, 'open tabs to inject');
    for (const tab of tabs) {
      injectContentScript(tab.id);
    }
  });
});

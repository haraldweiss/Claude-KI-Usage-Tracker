// Claude Usage Tracker - Content Script
// Provides DOM scraping for the manual / automatic sync flow.
// (Per-message tracking via fetch interception was removed: Claude.ai's web UI
// does not expose token counts in any response we can intercept.)

console.log('Claude Usage Tracker content script loaded');

// Respond to scrape requests from popup or background auto-sync.
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.type === 'SCRAPE_USAGE') {
    try {
      sendResponse({ success: true, data: scrapeUsageFromSettings() });
    } catch (error) {
      console.error('Scraping error:', error);
      sendResponse({ success: false, error: error.message });
    }
    return true;
  }
  return false;
});

// Scrape monthly spend and weekly usage % from the rendered settings/usage page.
function scrapeUsageFromSettings() {
  const scraped = {
    monthly_spent: 0,
    weekly_used: 0,
    session_used: 0,
    timestamp: new Date().toISOString()
  };

  const allText = document.body.innerText;

  const currencyMatch = allText.match(/[\d,\.]+\s*[€$]|[€$]\s*[\d,\.]+/);
  if (currencyMatch) {
    const amount = currencyMatch[0].replace(/[€$\s]/g, '').replace(',', '.');
    scraped.monthly_spent = parseFloat(amount) || 0;
  }

  const percentMatches = allText.match(/(\d+)\s*%/g);
  if (percentMatches && percentMatches.length > 0) {
    scraped.weekly_used = parseInt(percentMatches[0], 10) || 0;
  }

  return scraped;
}

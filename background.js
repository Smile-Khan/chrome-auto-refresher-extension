//
// Auto Refresher - Background Service Worker
//
// This is the brain of the extension. It's an event-driven service worker that manages all refresh timers and state.
// By using a service worker, we ensure the extension is efficient, only running when needed.
//

// --- Main Message Listener ---
// The popup UI and content scripts can't perform actions like setting alarms or reloading tabs directly.
// They send messages here, and this script acts as the central authority.
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  // A simple router to delegate tasks based on the message 'action'.
  if (request.action === 'start') {
    startRefresh(request.tabId, request.settings);
  } else if (request.action === 'stop') {
    stopRefresh(request.tabId);
  } else if (request.action === 'stopFromInteraction') {
    // This specific message comes from the content script if the user clicks/scrolls.
    if (sender.tab && sender.tab.id) {
      console.log(`User interaction detected. Halting refresh for tab ${sender.tab.id}.`);
      stopRefresh(sender.tab.id);
    }
  }

  // Acknowledging the message is good practice, especially for async operations.
  sendResponse({ status: 'acknowledged' });
  return true; // Keeps the message channel open for async response, though not used here.
});

/**
 * Initiates the refresh cycle for a given tab.
 * @param {number} tabId - The ID of the tab to refresh.
 * @param {object} settings - The configuration object from the popup.
 */
async function startRefresh(tabId, settings) {
  // Storing the full state in chrome.storage.local is key. This is our "single source of truth".
  // It persists even if the service worker goes dormant between actions.
  const tabState = {
    isRefreshing: true,
    settings: settings,
    remaining: settings.useCountdown ? settings.refreshCount : null
  };
  await chrome.storage.local.set({ [tabId]: tabState });

  // Set up the very first alarm to kick off the cycle.
  // Subsequent alarms will be set by the chrome.tabs.onUpdated listener.
  createNextAlarm(tabId, settings);

  // Provide immediate visual feedback to the user on the extension icon.
  await chrome.action.setBadgeText({ text: 'ON', tabId: tabId });
  await chrome.action.setBadgeBackgroundColor({ color: '#00A878', tabId: tabId });
  console.log(`Starting refresh cycle for tab ${tabId}`, settings);
}

/**
 * Halts the refresh cycle for a given tab.
 * @param {number} tabId - The ID of the tab to stop refreshing.
 */
async function stopRefresh(tabId) {
  // The order here is important: first, prevent future actions, then clean up the UI and state.
  console.log(`Stopping refresh for tab ${tabId}.`);

  // 1. Clear the pending alarm. This is the most critical step to stop the loop.
  await chrome.alarms.clear(`refresh-alarm-${tabId}`);
  
  // 2. Remove the state from storage to free up space and prevent stale data.
  await chrome.storage.local.remove(`${tabId}`);

  // 3. Tell the content script to clean up its UI (the favicon timer) and event listeners.
  // Using a try-catch block here because the tab might already be closed, which would throw an error.
  try {
    await chrome.tabs.sendMessage(tabId, { action: 'stopAll' });
  } catch (error) {
    console.log(`Tab ${tabId} was likely closed before we could send the 'stopAll' message. This is normal.`);
  }

  // 4. Clear the icon badge to show the user the process has stopped.
  await chrome.action.setBadgeText({ text: '', tabId: tabId });
}

/**
 * Creates the next one-shot alarm and notifies the content script.
 * @param {number} tabId
 * @param {object} settings
 */
function createNextAlarm(tabId, settings) {
  // I chose a one-shot alarm pattern because Manifest V3's 'periodInMinutes'
  // has a 1-minute minimum. To support shorter intervals, I create a new
  // single-use alarm after each successful page reload. This is the recommended approach.
  let delayInSeconds;
  if (settings.intervalType === 'random') {
    // Using a function for random calculation makes the code cleaner.
    delayInSeconds = getRandomInt(settings.randomMin, settings.randomMax);
  } else {
    delayInSeconds = settings.totalSeconds;
  }
  
  // Create the one-time alarm. The name is tab-specific.
  chrome.alarms.create(`refresh-alarm-${tabId}`, {
    delayInMinutes: delayInSeconds / 60
  });

  // If the visual timer is enabled, send the duration to the content script.
  if (settings.visualTimer) {
    chrome.tabs.sendMessage(tabId, { action: 'startTimer', duration: delayInSeconds })
      .catch(e => console.warn("Could not send 'startTimer' message. Tab may not be ready or active.", e.message));
  }

  // Also tell the content script to start listening for user clicks/scrolls.
  if (settings.stopOnInteraction) {
    chrome.tabs.sendMessage(tabId, { action: 'addInteractionListeners' })
      .catch(e => console.warn("Could not send interaction listener message.", e.message));
  }
}


// --- Main Alarm Listener ---
// This listener fires when any alarm created by `chrome.alarms` goes off.
chrome.alarms.onAlarm.addListener(async (alarm) => {
  // We only care about alarms that belong to this extension.
  if (alarm.name.startsWith('refresh-alarm-')) {
    const tabId = parseInt(alarm.name.split('-')[2], 10);
    const result = await chrome.storage.local.get([`${tabId}`]);
    const tabState = result[tabId];

    // This is a safety check. If the user clicked "Stop", the state would be gone.
    // This prevents a race condition where an alarm fires right after the user stops it.
    if (!tabState || !tabState.isRefreshing) {
      console.log(`Alarm fired for tab ${tabId}, but state is gone. Stopping any further action.`);
      await stopRefresh(tabId);
      return;
    }

    // Handle the refresh countdown feature.
    if (tabState.settings.useCountdown) {
      tabState.remaining -= 1;
      if (tabState.remaining <= 0) {
        console.log(`Final refresh count reached for tab ${tabId}. Halting.`);
        await stopRefresh(tabId); // This stops the cycle completely.
        return; // Important: Return here to prevent the final reload and next alarm.
      }
      // If there are refreshes left, save the new count.
      await chrome.storage.local.set({ [tabId]: tabState });
    }

    // All checks passed, let's reload the tab.
    // bypassCache performs a "hard refresh" (Ctrl+F5).
    await chrome.tabs.reload(tabId, { bypassCache: tabState.settings.hardRefresh });
    console.log(`Reloading tab ${tabId}. Hard Refresh: ${tabState.settings.hardRefresh}`);
  }
});


// --- Tab Event Listeners ---
// The `onUpdated` listener is the key to our resilient refresh cycle.
// It allows us to act *after* a page has successfully reloaded.
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  // We only care about when the tab is fully loaded and ready.
  if (changeInfo.status === 'complete') {
    const result = await chrome.storage.local.get([`${tabId}`]);
    const tabState = result[tabId];

    // If this tab is one we are actively managing...
    if (tabState && tabState.isRefreshing) {
      console.log(`Tab ${tabId} has finished reloading. Setting up the next refresh cycle.`);
      // Now that the page is fresh, we set the *next* alarm. This completes the loop.
      createNextAlarm(tabId, tabState.settings);
    }
  }
});

// This is a crucial cleanup step. If a user closes a tab, we need to stop the
// alarm and remove its data to prevent wasted resources.
chrome.tabs.onRemoved.addListener((tabId) => {
  // I don't need to check if we are managing this tab. `stopRefresh` is idempotent,
  // meaning it safely does nothing if the alarm or storage doesn't exist.
  stopRefresh(tabId);
});


// --- Helper Functions ---
// Encapsulating small, reusable logic into helper functions makes the main code cleaner.
function getRandomInt(min, max) {
  min = Math.ceil(min);
  max = Math.floor(max);
  return Math.floor(Math.random() * (max - min + 1)) + min;
}
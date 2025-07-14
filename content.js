//
// Auto Refresher - Content Script
//
// This script runs in the isolated context of the web page itself.
// Its primary jobs are to display the visual favicon timer and to detect
// user interaction to stop the refresh cycle.
//

const pageManager = {
  timerInterval: null,
  originalFavicon: null,

  init() {
    // Store the page's original favicon URL so we can restore it later.
    // If one doesn't exist, this will be null, which we handle in restore().
    const link = document.querySelector("link[rel*='icon']");
    this.originalFavicon = link ? link.href : null;
    this.listenForMessages();
  },

  listenForMessages() {
    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
      // Using a switch statement is a clean way to handle different message actions.
      switch (request.action) {
        case 'startTimer':
          this.startVisualTimer(request.duration);
          break;
        case 'addInteractionListeners':
          this.addInteractionListeners();
          break;
        case 'stopAll':
          // A single, clean command to stop all activity on this page.
          this.stopVisualTimer();
          this.removeInteractionListeners();
          break;
      }
    });
  },
  
  startVisualTimer(duration) {
    clearInterval(this.timerInterval); // Always clear any existing timer first.
    let timeLeft = Math.round(duration);
    
    // Using an arrow function to maintain the 'this' context of our pageManager object.
    const tick = () => {
      if (timeLeft >= 0) {
        this.drawFavicon(timeLeft);
        timeLeft--;
      } else {
        clearInterval(this.timerInterval);
      }
    };
    
    tick(); // Run immediately so the user sees the timer start at the correct number.
    this.timerInterval = setInterval(tick, 1000);
  },

  stopVisualTimer() {
    clearInterval(this.timerInterval);
    this.restoreFavicon();
  },
  
  drawFavicon(timeLeft) {
    const canvas = document.createElement('canvas');
    canvas.width = 32;
    canvas.height = 32;
    const ctx = canvas.getContext('2d');
    
    // Draw background
    ctx.fillStyle = '#00A878'; // Match the theme color
    ctx.fillRect(0, 0, 32, 32);
    
    // Draw text
    ctx.fillStyle = 'white';
    ctx.font = 'bold 18px Arial';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(timeLeft.toString(), 16, 17); // Nudge text down slightly for better centering
    
    this.updateFaviconLink(canvas.toDataURL('image/png'));
  },

  updateFaviconLink(href) {
    let link = document.querySelector("link[rel*='icon']");
    if (!link) {
      link = document.createElement('link');
      link.rel = 'shortcut icon';
      document.head.appendChild(link);
    }
    link.href = href;
  },

  restoreFavicon() {
    if (this.originalFavicon) {
      this.updateFaviconLink(this.originalFavicon);
    } else {
      // If there was no original favicon, it's best to remove the one we added.
      let link = document.querySelector("link[rel*='icon']");
      if (link) link.remove();
    }
  },

  // --- Interaction Handling ---
  onUserInteraction() {
    console.log('User interacted, stopping timer.');
    // A single message to the background script is all that's needed.
    // The background script is the authority and will handle the full stop logic.
    chrome.runtime.sendMessage({ action: 'stopFromInteraction' });
    pageManager.stopVisualTimer(); // Clean up this script's UI immediately.
    pageManager.removeInteractionListeners();
  },

  addInteractionListeners() {
    // These listeners are added with { once: true }, so they automatically remove
    // themselves after firing once. This is very efficient.
    document.addEventListener('mousedown', this.onUserInteraction, { once: true, capture: true });
    document.addEventListener('keydown', this.onUserInteraction, { once: true, capture: true });
  },
  
  removeInteractionListeners() {
    // While { once: true } cleans up after firing, we need a way to manually
    // remove them if the user clicks "Stop" in the popup.
    document.removeEventListener('mousedown', this.onUserInteraction, { capture: true });
    document.removeEventListener('keydown', this.onUserInteraction, { capture: true });
  }
};

// Kick things off.
pageManager.init();
document.addEventListener('DOMContentLoaded', async () => {
    // --- UI Element References ---
    const startButton = document.getElementById('startButton');
    const stopButton = document.getElementById('stopButton');
    const statusDiv = document.getElementById('status');
    const enableCountCheckbox = document.getElementById('enableRefreshCount');
    const refreshCountInput = document.getElementById('refreshCount'); // Hidden input

    let [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

    // --- Helper to manage UI state ---
    const updateUIState = (isRefreshing, data = {}) => {
        document.querySelectorAll('.container input').forEach(input => {
            if (input.id !== 'refreshCount') { // Don't disable the hidden input
                input.disabled = isRefreshing;
            }
        });

        startButton.disabled = isRefreshing;
        stopButton.disabled = !isRefreshing;

        if (isRefreshing && data.settings) {
            let statusText = `Status: Refreshing...`;
            if (data.settings.useCountdown && data.remaining) {
                statusText += ` ${data.remaining} refreshes left.`;
            }
            statusDiv.textContent = statusText;
        } else {
            statusDiv.textContent = 'Status: Idle';
        }
    };

    // --- Function to get all settings from the UI ---
    const gatherSettings = () => {
        const settings = {
            intervalType: document.querySelector('input[name="intervalType"]:checked')?.value || 's',
            hardRefresh: document.getElementById('hardRefresh').checked,
            useCountdown: enableCountCheckbox.checked,
            refreshCount: parseInt(document.getElementById('refreshCount').value, 10),
            visualTimer: document.getElementById('visualTimer').checked,
            stopOnInteraction: document.getElementById('stopOnInteraction').checked
        };

        let totalSeconds = 0;
        switch (settings.intervalType) {
            case '5s': totalSeconds = 5; break;
            case '10s': totalSeconds = 10; break;
            case '15s': totalSeconds = 15; break;
            case '5m': totalSeconds = 300; break;
            case '10m': totalSeconds = 600; break;
            case '15m': totalSeconds = 900; break;
            case 'hms':
                const h = parseInt(document.getElementById('hms-h').value, 10) || 0;
                const m = parseInt(document.getElementById('hms-m').value, 10) || 0;
                const s = parseInt(document.getElementById('hms-s').value, 10) || 0;
                totalSeconds = (h * 3600) + (m * 60) + s;
                break;
            case 's':
                totalSeconds = parseInt(document.getElementById('s-s').value, 10) || 10;
                break;
            case 'random':
                settings.randomMin = parseInt(document.getElementById('randomMin').value, 10) || 5;
                settings.randomMax = parseInt(document.getElementById('randomMax').value, 10) || 30;
                totalSeconds = settings.randomMin; // Set a default
                break;
        }
        
        settings.totalSeconds = totalSeconds;
        return settings;
    };

    // --- Load Saved State on Popup Open ---
    chrome.storage.local.get([`${tab.id}`], (result) => {
        const data = result[tab.id];
        if (data && data.isRefreshing) {
            updateUIState(true, data);
        } else {
            updateUIState(false);
        }
    });

    // --- Event Listeners ---
    startButton.addEventListener('click', () => {
        const settings = gatherSettings();
        
        if (settings.totalSeconds < 5 && settings.intervalType !== 'random') {
            statusDiv.textContent = "Error: Interval must be at least 5 seconds.";
            return;
        }
        if (settings.intervalType === 'random' && settings.randomMin >= settings.randomMax) {
            statusDiv.textContent = "Error: Min interval must be less than Max.";
            return;
        }

        chrome.runtime.sendMessage({ action: 'start', tabId: tab.id, settings: settings }, () => {
            window.close();
        });
    });

    stopButton.addEventListener('click', () => {
        chrome.runtime.sendMessage({ action: 'stop', tabId: tab.id }, () => {
            updateUIState(false);
        });
    });
});
const enabled = document.querySelector('#enabled');
const stateText = document.querySelector('#stateText');
const status = document.querySelector('#status');

document.addEventListener('DOMContentLoaded', refresh);
enabled.addEventListener('change', async () => {
  await chrome.storage.local.set({ enabled: enabled.checked });
  renderState(enabled.checked);
});

chrome.storage.onChanged.addListener(changes => {
  if (changes.enabled) {
    renderState(changes.enabled.newValue !== false);
  }

  if (changes.status || changes.cueCount || changes.cuesByTab) {
    refresh();
  }
});

async function refresh() {
  const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const result = await chrome.storage.local.get({
    enabled: true,
    cueCount: 0,
    status: 'Waiting for Chinese subtitles...',
    cuesByTab: {}
  });

  renderState(result.enabled !== false);

  const tabCache = activeTab?.id ? result.cuesByTab?.[String(activeTab.id)] : null;
  const cueCount = tabCache?.cueCount || tabCache?.cues?.length || result.cueCount || 0;
  status.textContent = cueCount > 0 ? `${cueCount} cues loaded` : result.status;
}

function renderState(isEnabled) {
  enabled.checked = isEnabled;
  stateText.textContent = isEnabled ? 'ON' : 'OFF';
}

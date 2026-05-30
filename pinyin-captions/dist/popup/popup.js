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

  if (changes.status || changes.cueCount || changes.cuesByTab || changes.subtitleDebugByTab) {
    refresh();
  }
});

async function refresh() {
  const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const pageStatus = activeTab?.id
    ? await chrome.tabs.sendMessage(activeTab.id, { type: 'GET_PAGE_STATUS' }).catch(() => null)
    : null;
  const result = await chrome.storage.local.get({
    enabled: true,
    status: 'Waiting for Chinese subtitles...',
    cuesByTab: {},
    subtitleDebugByTab: {}
  });

  renderState(result.enabled !== false);

  const tabCache = activeTab?.id ? result.cuesByTab?.[String(activeTab.id)] : null;
  const debug = activeTab?.id ? result.subtitleDebugByTab?.[String(activeTab.id)] : null;
  const cueCount = pageStatus?.cueCount || tabCache?.cueCount || tabCache?.cues?.length || 0;

  if (pageStatus?.ok) {
    const videoState = pageStatus.hasVideo ? 'video detected' : 'waiting for video';
    const matchState = cueCount > 0
      ? pageStatus.matchedCue ? 'active cue matched' : 'no active cue at current time'
      : pageStatus.usingVisibleSubtitleFallback ? 'using visible subtitle fallback'
      : result.status;
    status.textContent = cueCount > 0
      ? `${cueCount} cues loaded - ${videoState} - ${matchState}`
      : `${videoState} - ${debug ? `${debug.status} - ${debug.host}` : result.status}`;
    return;
  }

  status.textContent = cueCount > 0
    ? `${cueCount} cues loaded for this tab`
    : debug ? `${debug.status} - ${debug.host}` : 'Waiting for Chinese subtitles...';
}

function renderState(isEnabled) {
  enabled.checked = isEnabled;
  stateText.textContent = isEnabled ? 'ON' : 'OFF';
}

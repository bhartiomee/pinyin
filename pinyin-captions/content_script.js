import { convertToPinyin } from './pinyin_converter.js';

const SUPPORTED_HOSTS = ['netflix.com', 'youtube.com', 'primevideo.com', 'disneyplus.com', 'hotstar.com'];
const STATE = {
  enabled: true,
  video: null,
  cues: [],
  tabId: null,
  cueTimeOffset: 0,
  originalLanguage: null,
  lastCue: null,
  banner: null,
  overlay: null,
  hasShownLoadedToast: false
};

init();

async function init() {
  const stored = await chrome.storage.local.get({ enabled: true });
  STATE.enabled = stored.enabled !== false;

  chrome.storage.onChanged.addListener(changes => {
    if (changes.enabled) {
      STATE.enabled = changes.enabled.newValue !== false;
      setOverlayText('');
    }

    if (changes.cuesByTab) {
      restoreCachedCues({ activate: true });
    }
  });

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message?.type === 'CHINESE_CUES' && Array.isArray(message.cues)) {
      handleChineseCues(message.cues);
      sendResponse({ ok: true });
    }
    return true;
  });

  await restoreCachedCues();
  waitForVideo();
  document.addEventListener('fullscreenchange', ensureOverlayParent);
}

function waitForVideo() {
  const existingVideo = document.querySelector('video');
  if (existingVideo) {
    attachVideo(existingVideo);
    return;
  }

  const observer = new MutationObserver(() => {
    const video = document.querySelector('video');
    if (video) {
      observer.disconnect();
      attachVideo(video);
    }
  });

  observer.observe(document.body || document.documentElement, {
    childList: true,
    subtree: true
  });
}

function attachVideo(video) {
  if (STATE.video === video) {
    return;
  }

  STATE.video = video;
  STATE.originalLanguage = getShowingTrackLanguage(video);
  createOverlay();

  if (!STATE.cues.length) {
    showSetupBanner();
  }

  video.addEventListener('timeupdate', updateOverlay);
  video.addEventListener('play', updateOverlay);
  updateOverlay();
}

async function restoreCachedCues({ activate = false } = {}) {
  if (!STATE.tabId) {
    const tab = await chrome.runtime.sendMessage({ type: 'PING_TAB_ID' }).catch(() => null);
    STATE.tabId = tab?.id || null;
  }

  if (!STATE.tabId) {
    return;
  }

  const result = await chrome.storage.local.get({ cuesByTab: {} });
  const cached = result.cuesByTab?.[String(STATE.tabId)];
  if (cached?.cues?.length) {
    applyCues(cached.cues, { restoreLanguage: false, showLoadedToast: activate });
  }
}

function handleChineseCues(cues) {
  applyCues(cues, { restoreLanguage: true, showLoadedToast: true });
}

function applyCues(cues, { restoreLanguage = false, showLoadedToast = false } = {}) {
  STATE.cues = normalizeCues(cues);
  STATE.cueTimeOffset = inferCueTimeOffset();
  STATE.lastCue = null;
  hideSetupBanner();

  if (restoreLanguage) {
    switchBackToOriginalLanguage();
  }

  if (showLoadedToast && !STATE.hasShownLoadedToast) {
    showToast('✓ Pinyin Captions loaded. Switch back to English subtitles.');
    STATE.hasShownLoadedToast = true;
  }

  updateOverlay();
}

function normalizeCues(cues) {
  return cues
    .map(cue => ({
      start: Number(cue.start),
      end: Number(cue.end),
      text: String(cue.text || '')
    }))
    .filter(cue => Number.isFinite(cue.start) && Number.isFinite(cue.end) && cue.text)
    .sort((a, b) => a.start - b.start);
}

function updateOverlay() {
  if (!STATE.enabled || !STATE.video || !STATE.cues.length) {
    setOverlayText('');
    return;
  }

  const currentTime = STATE.video.currentTime + STATE.cueTimeOffset;
  const activeCue = findActiveCue(currentTime);

  if (!activeCue) {
    STATE.lastCue = null;
    setOverlayText('');
    return;
  }

  if (STATE.lastCue === activeCue) {
    return;
  }

  STATE.lastCue = activeCue;
  setOverlayText(convertToPinyin(activeCue.text));
}

function createOverlay() {
  if (STATE.overlay) {
    return STATE.overlay;
  }

  const overlay = document.createElement('div');
  overlay.id = 'pinyin-overlay';
  Object.assign(overlay.style, {
    position: 'fixed',
    bottom: '12%',
    left: '0',
    width: '100%',
    textAlign: 'center',
    fontSize: '22px',
    color: 'white',
    textShadow: '0 0 6px black, 1px 1px 3px black',
    zIndex: '2147483647',
    pointerEvents: 'none',
    fontFamily: 'sans-serif',
    letterSpacing: '0.05em',
    padding: '0 24px',
    boxSizing: 'border-box',
    lineHeight: '1.35'
  });

  STATE.overlay = overlay;
  ensureOverlayParent();
  return overlay;
}

function setOverlayText(text) {
  const overlay = createOverlay();
  ensureOverlayParent();
  overlay.textContent = text || '';
}

function ensureOverlayParent() {
  if (!STATE.overlay) {
    return;
  }

  const parent = document.fullscreenElement || document.body || document.documentElement;
  if (STATE.overlay.parentElement !== parent) {
    parent.appendChild(STATE.overlay);
  }
}

function findActiveCue(currentTime) {
  let low = 0;
  let high = STATE.cues.length - 1;

  while (low <= high) {
    const index = Math.floor((low + high) / 2);
    const cue = STATE.cues[index];

    if (currentTime < cue.start) {
      high = index - 1;
    } else if (currentTime > cue.end) {
      low = index + 1;
    } else {
      return cue;
    }
  }

  return null;
}

function inferCueTimeOffset() {
  if (!STATE.video || STATE.cues.length < 2) {
    return 0;
  }

  const firstCue = STATE.cues[0];
  const lastCue = STATE.cues[STATE.cues.length - 1];
  const cueSpan = lastCue.end - firstCue.start;
  const videoDuration = Number.isFinite(STATE.video.duration) ? STATE.video.duration : 0;

  if (firstCue.start > 300 && videoDuration > 0 && cueSpan <= videoDuration + 300) {
    return firstCue.start;
  }

  return 0;
}

function showSetupBanner() {
  if (STATE.banner || !isSupportedHost()) {
    return;
  }

  const banner = document.createElement('div');
  banner.id = 'pinyin-captions-setup-banner';
  Object.assign(banner.style, {
    position: 'fixed',
    top: '16px',
    left: '50%',
    transform: 'translateX(-50%)',
    maxWidth: 'min(720px, calc(100vw - 32px))',
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
    padding: '12px 14px',
    borderRadius: '8px',
    background: 'rgba(12, 12, 12, 0.92)',
    color: '#fff',
    fontFamily: 'Arial, sans-serif',
    fontSize: '14px',
    lineHeight: '1.35',
    boxShadow: '0 8px 28px rgba(0, 0, 0, 0.35)',
    zIndex: '100000'
  });

  const message = document.createElement('span');
  message.textContent = "Pinyin Captions: Please switch to Chinese subtitles for a moment — we'll switch back automatically.";

  const dismiss = document.createElement('button');
  dismiss.type = 'button';
  dismiss.textContent = 'Dismiss';
  Object.assign(dismiss.style, {
    appearance: 'none',
    border: '1px solid rgba(255, 255, 255, 0.36)',
    borderRadius: '6px',
    background: 'rgba(255, 255, 255, 0.12)',
    color: '#fff',
    padding: '6px 10px',
    cursor: 'pointer',
    font: 'inherit',
    flex: '0 0 auto'
  });
  dismiss.addEventListener('click', hideSetupBanner);

  banner.append(message, dismiss);
  document.documentElement.appendChild(banner);
  STATE.banner = banner;
}

function hideSetupBanner() {
  STATE.banner?.remove();
  STATE.banner = null;
}

function showToast(text) {
  const toast = document.createElement('div');
  toast.textContent = text;
  Object.assign(toast.style, {
    position: 'fixed',
    top: '16px',
    right: '16px',
    padding: '10px 12px',
    borderRadius: '8px',
    background: 'rgba(12, 12, 12, 0.92)',
    color: '#fff',
    fontFamily: 'Arial, sans-serif',
    fontSize: '13px',
    zIndex: '100000',
    boxShadow: '0 8px 28px rgba(0, 0, 0, 0.35)'
  });

  document.documentElement.appendChild(toast);
  setTimeout(() => toast.remove(), 4200);
}

function getShowingTrackLanguage(video) {
  const tracks = Array.from(video.querySelectorAll('track'));
  const showingTrack = tracks.find(track => track.track?.mode === 'showing' || track.default);
  return showingTrack?.srclang || showingTrack?.label || null;
}

function switchBackToOriginalLanguage() {
  if (!STATE.originalLanguage) {
    return;
  }

  if (location.hostname.includes('youtube.com')) {
    switchYouTubeCaptionLanguage(STATE.originalLanguage);
    return;
  }

  const tracks = Array.from(STATE.video?.querySelectorAll('track') || []);
  tracks.forEach(track => {
    const matchesOriginal = track.srclang === STATE.originalLanguage || track.label === STATE.originalLanguage;
    if (track.track) {
      track.track.mode = matchesOriginal ? 'showing' : 'hidden';
    }
  });
}

function switchYouTubeCaptionLanguage(originalLanguage) {
  const videoTracks = Array.from(STATE.video?.querySelectorAll('track') || []);
  if (videoTracks.length) {
    videoTracks.forEach(track => {
      const matchesOriginal = track.srclang === originalLanguage || track.label === originalLanguage;
      if (track.track) {
        track.track.mode = matchesOriginal ? 'showing' : 'hidden';
      }
    });
    return;
  }

  const captionsButton = document.querySelector('.ytp-subtitles-button');
  if (captionsButton?.getAttribute('aria-pressed') === 'false') {
    captionsButton.click();
  }

  const settingsButton = document.querySelector('.ytp-settings-button');
  if (!settingsButton) {
    return;
  }

  settingsButton.click();
  setTimeout(() => {
    const subtitleItem = findYouTubeMenuItem(/subtitles|captions|cc/i);
    subtitleItem?.click();

    setTimeout(() => {
      const originalItem = findYouTubeMenuItem(languageMatcher(originalLanguage));
      originalItem?.click();
      closeYouTubeSettingsMenu();
    }, 250);
  }, 250);
}

function findYouTubeMenuItem(matcher) {
  return Array.from(document.querySelectorAll('.ytp-menuitem, .ytp-panel-menu .ytp-menuitem'))
    .find(item => matcher.test(item.textContent || ''));
}

function languageMatcher(language) {
  const aliases = {
    en: 'english',
    'en-us': 'english',
    'en-gb': 'english',
    zh: 'chinese',
    'zh-cn': 'chinese',
    'zh-tw': 'chinese'
  };
  const normalized = String(language || '').toLowerCase();
  const label = aliases[normalized] || normalized;
  return new RegExp(escapeRegExp(label), 'i');
}

function closeYouTubeSettingsMenu() {
  const settingsButton = document.querySelector('.ytp-settings-button');
  if (settingsButton?.getAttribute('aria-expanded') === 'true') {
    settingsButton.click();
  }
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function isSupportedHost() {
  return SUPPORTED_HOSTS.some(host => location.hostname.includes(host));
}

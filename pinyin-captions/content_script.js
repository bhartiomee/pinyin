import { convertToPinyin } from './pinyin_converter.js';

const SUPPORTED_HOSTS = ['netflix.com', 'youtube.com', 'primevideo.com', 'disneyplus.com', 'hotstar.com'];
const CHINESE_RE = /[\u4e00-\u9fff]/;
const STATE = {
  enabled: true,
  video: null,
  cues: [],
  usingVisibleSubtitleFallback: false,
  tabId: null,
  cueTimeOffset: 0,
  originalLanguage: null,
  lastCue: null,
  banner: null,
  overlay: null,
  hasShownLoadedToast: false,
  lastAlignmentAttempt: 0
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
    if (message?.type === 'SUBTITLE_CUES' && Array.isArray(message.cues)) {
      handleSubtitleCues(message.cues, message.language);
      sendResponse({ ok: true });
    }
    
    // Backward compatibility with old CHINESE_CUES message type
    if (message?.type === 'CHINESE_CUES' && Array.isArray(message.cues)) {
      handleChineseCues(message.cues);
      sendResponse({ ok: true });
    }

    if (message?.type === 'GET_PAGE_STATUS') {
      const currentTime = STATE.video ? STATE.video.currentTime + STATE.cueTimeOffset : 0;
      const activeCue = STATE.cues.length ? findActiveCue(currentTime) : null;
      sendResponse({
        ok: true,
        enabled: STATE.enabled,
        hasVideo: Boolean(STATE.video),
        cueCount: STATE.cues.length,
        usingVisibleSubtitleFallback: STATE.usingVisibleSubtitleFallback,
        videoTime: STATE.video?.currentTime ?? null,
        cueTimeOffset: STATE.cueTimeOffset,
        matchedCue: Boolean(activeCue),
        sampleCue: activeCue?.text || STATE.cues[0]?.text || ''
      });
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
  video.addEventListener('pause', updateOverlay);
  
  // Monitor for subtitle changes (especially useful for Netflix when switching subs)
  monitorSubtitleChanges();
  
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
 

function handleSubtitleCues(cues, language) {
  // Handle both Chinese and English/other language subtitles
  applyCues(cues, { 
    restoreLanguage: language === 'zh', 
    showLoadedToast: true,
    language 
  });
}   applyCues(cached.cues, { restoreLanguage: false, showLoadedToast: activate });
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
    showToast('✓ Pinyin Captions loaded. Switch between subtitle languages to see Pinyin translations.');
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
  if (!STATE.enabled || !STATE.video) {
    setOverlayText('');
    return;
  }

  const isNetflix = location.hostname.includes('netflix.com');
  
  // Try using cached cues first (if we have them from intercepted requests)
  const currentTime = STATE.video.currentTime + STATE.cueTimeOffset;
  let activeCue = STATE.cues.length ? findActiveCue(currentTime) : null;

  // If no cached cues or cue not found, try to align using visible subtitles
  if (!activeCue && STATE.cues.length && !isNetflix) {
    if (tryAlignCueOffsetFromVisibleSubtitles()) {
      activeCue = findActiveCue(STATE.video.currentTime + STATE.cueTimeOffset);
    }
  }

  // If still no cue, use fallback from visible subtitles
  // For Netflix, this is the PRIMARY method since Netflix doesn't expose subtitle files
  if (!activeCue) {
    updateOverlayFromVisibleSubtitles();
    return;
  }

  if (STATE.lastCue === activeCue) {
    return;
  }

  STATE.lastCue = activeCue;
  STATE.usingVisibleSubtitleFallback = false;
  setOverlayText(convertToPinyin(activeCue.text));
}

function updateOverlayFromVisibleSubtitles() {
  const { text: visibleText, isChinese } = getVisibleSubtitleText();

  if (!visibleText) {
    STATE.usingVisibleSubtitleFallback = false;
    setOverlayText('');
    return;
  }

  STATE.usingVisibleSubtitleFallback = true;
  const pinyin = convertToPinyin(visibleText);
  setOverlayText(pinyin);
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

function tryAlignCueOffsetFromVisibleSubtitles() {
  if (!STATE.video || !STATE.cues.length || !location.hostname.includes('netflix.com')) {
    return false;
  }

  const now = Date.now();
  if (now - STATE.lastAlignmentAttempt < 800) {
    return false;
  }
  STATE.lastAlignmentAttempt = now;

  const visibleText = normalizeComparableChinese(getVisibleChineseSubtitleText());
  if (!visibleText) {
    return false;
  }

  const matchingCue = STATE.cues.find(cue => {
    const cueText = normalizeComparableChinese(cue.text);
    return cueText && (cueText.includes(visibleText) || visibleText.includes(cueText));
  });

  if (!matchingCue) {
    return false;
  }

  STATE.cueTimeOffset = matchingCue.start - STATE.video.currentTime;
  STATE.lastCue = null;
  return true;
}

function getVisibleSubtitleText() {
  const selectors = [
    // Netflix
    '[class*="player-timedtext"]',
    '[class*="timedtext"]',
    '[class*="player-subtitle"]',
    'span[role="presentation"][class*="subtitle"]',
    'div[class*="player-core"]',
    
    // General
    '[class*="subtitle"]',
    '[class*="caption"]',
    '[data-uia*="subtitle"]',
    '.vjs-text-track-display',
    '[role="region"][aria-live]',
    
    // Backup: look for any visible text element that might be subtitles
    'p[class*="subtitle"]',
    'span[class*="caption"]'
  ];
  
  const candidates = Array.from(document.querySelectorAll(selectors.join(',')))
    .filter(element => {
      // Skip our own overlay and banner
      if (element === STATE.overlay || element === STATE.banner) return false;
      
      const text = element.textContent || '';
      if (!text.trim()) return false;
      
      const rect = element.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return false;
      
      // For Netflix: usually near bottom of screen
      const isLikelySubtitle = rect.bottom > window.innerHeight * 0.5; // Lower half of screen
      return isLikelySubtitle;
    })
    .map(element => ({
      element,
      text: element.textContent || '',
      rect: element.getBoundingClientRect(),
      depth: getElementDepth(element)
    }))
    .filter(({ text, rect, element }) => {
      const style = getComputedStyle(element);
      return rect.width > 0 &&
        rect.height > 0 &&
        style.visibility !== 'hidden' &&
        style.display !== 'none' &&
        Number(style.opacity || 1) > 0;
    })
    .sort((a, b) => {
      // Prioritize elements closest to bottom of viewport
      return b.rect.bottom - a.rect.bottom;
    });

  const topCandidate = candidates[0];
  if (!topCandidate) {
    return { text: '', isChinese: false };
  }
  
  const text = topCandidate.text;
  const isChinese = CHINESE_RE.test(text);
  return { text, isChinese };
}

function getElementDepth(el) {
  let depth = 0;
  let current = el;
  while (current && current.parentElement) {
    depth++;
    current = current.parentElement;
  }
  return depth;
}

function getVisibleChineseSubtitleText() {
  const { text, isChinese } = getVisibleSubtitleText();
  return isChinese ? text : '';
}

function normalizeComparableChinese(text) {
  return String(text || '')
    .replace(/<[^>]*>/g, '')
    .replace(/[^\u4e00-\u9fff]/g, '')
    .trim();
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

  const isNetflix = location.hostname.includes('netflix.com');
  const message = document.createElement('span');
  message.textContent = isNetflix 
    ? "✓ Pinyin Captions ready! Pinyin will appear below any subtitles on Netflix."
    : "✓ Pinyin Captions ready! Switch to Chinese subtitles to load Pinyin translations.";

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

function monitorSubtitleChanges() {
  let lastSeenSubtitleText = '';
  let lastUpdateTime = 0;
  const isNetflix = location.hostname.includes('netflix.com');
  
  // For Netflix, check frequently since subtitles can change rapidly
  const throttleMs = isNetflix ? 100 : 500;
  
  const checkSubtitleChange = () => {
    const now = Date.now();
    if (now - lastUpdateTime < throttleMs) return;
    lastUpdateTime = now;
    
    const { text: currentText } = getVisibleSubtitleText();
    
    // Update if subtitle text changed
    if (currentText && currentText !== lastSeenSubtitleText) {
      lastSeenSubtitleText = currentText;
      STATE.lastCue = null; // Reset to force update
      updateOverlay();
    }
  };
  
  // Monitor video timeupdate events (most reliable for detecting subtitle changes)
  if (STATE.video) {
    STATE.video.addEventListener('timeupdate', checkSubtitleChange);
    STATE.video.addEventListener('pause', checkSubtitleChange);
    STATE.video.addEventListener('play', checkSubtitleChange);
  }
  
  // Also use MutationObserver as a fallback
  const observer = new MutationObserver(checkSubtitleChange);
  
  // Start observing after a brief delay to ensure DOM is ready
  setTimeout(() => {
    try {
      observer.observe(document.body || document.documentElement, {
        childList: true,
        subtree: true,
        characterData: true,
        characterDataOldValue: false,
        attributes: false
      });
    } catch (e) {
      console.debug('Could not attach subtitle monitor:', e.message);
    }
  }, 1000);
}

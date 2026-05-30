(() => {
  // pinyin-captions/background.js
  var SUBTITLE_URL_RE = /(\.vtt(?:\?|$)|\.ttml(?:\?|$)|\.dfxp(?:\?|$)|\.xml(?:\?|$)|ttml2|webvtt|dfxp|subtitle|caption|timedtext|texttrack|text_track)/i;
  var NETFLIX_RANGE_RE = /^https:\/\/[^/]+\.nflxvideo\.net\/range\/(\d+)-(\d+)/i;
  var CHINESE_RE = /[\u4e00-\u9fff]/;
  var FETCHED_URLS = /* @__PURE__ */ new Map();
  var CACHE_TTL_MS = 2 * 60 * 1e3;
  var MAX_NETFLIX_RANGE_BYTES = 750 * 1024;
  var REQUEST_URLS = [
    "*://*.netflix.com/*",
    "*://*.nflxvideo.net/*",
    "*://*.youtube.com/*",
    "*://*.primevideo.com/*",
    "*://*.disneyplus.com/*",
    "*://*.hotstar.com/*"
  ];
  chrome.runtime.onInstalled.addListener(() => {
    chrome.storage.local.set({
      enabled: true,
      status: "Waiting for Chinese subtitles...",
      cuesByTab: {}
    });
  });
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message?.type === "PING_TAB_ID") {
      sendResponse({ id: sender.tab?.id ?? null });
    }
    return false;
  });
  chrome.webRequest.onBeforeRequest.addListener(
    (details) => {
      if (details.tabId < 0 || !details.url || !isSubtitleCandidateUrl(details.url)) {
        return;
      }
      rememberSubtitleCandidate(details.tabId, details.url, "seen");
      const cachedAt = FETCHED_URLS.get(details.url);
      if (cachedAt && Date.now() - cachedAt < CACHE_TTL_MS) {
        return;
      }
      FETCHED_URLS.set(details.url, Date.now());
      fetchSubtitle(details.tabId, details.url).catch((error) => {
        console.warn("Pinyin Captions: failed to inspect subtitle request", error);
      });
    },
    { urls: REQUEST_URLS }
  );
  async function fetchSubtitle(tabId, url) {
    const enabled = await getEnabled();
    if (!enabled) {
      return;
    }
    if (isOversizedNetflixRange(url)) {
      await rememberSubtitleCandidate(tabId, url, "skipped large Netflix range");
      return;
    }
    const response = await fetch(url, {
      credentials: "include",
      cache: "force-cache"
    });
    if (!response.ok) {
      await rememberSubtitleCandidate(tabId, url, `fetch failed ${response.status}`);
      return;
    }
    const buffer = await response.arrayBuffer();
    const text = new TextDecoder("utf-8", { fatal: false }).decode(buffer);
    if (!looksLikeTextSubtitlePayload(text)) {
      await rememberSubtitleCandidate(tabId, url, "fetched range, not text subtitle");
      return;
    }
    const cues = parseSubtitle(text, url);
    const sample = cues.slice(0, 12).map((cue) => cue.text).join(" ").slice(0, 500);
    if (!cues.length || !CHINESE_RE.test(sample)) {
      await rememberSubtitleCandidate(tabId, url, `parsed ${cues.length} cues, not Chinese`);
      return;
    }
    await cacheCues(tabId, cues);
    chrome.tabs.sendMessage(tabId, { type: "CHINESE_CUES", cues }, () => {
      if (chrome.runtime.lastError) {
        console.debug("Pinyin Captions: content script unavailable", chrome.runtime.lastError.message);
      }
    });
  }
  function parseSubtitle(text, url = "") {
    const looksLikeYouTubeTimedText = /timedtext/i.test(url) || /"events"\s*:\s*\[/i.test(text) || /<text\b[^>]*(start|dur)=/i.test(text);
    const looksLikeTtml = /\.ttml/i.test(url) || /ttml2/i.test(url) || /<tt[\s>]/i.test(text) || /<p\b[^>]*(begin|end)=/i.test(text);
    if (looksLikeYouTubeTimedText) {
      return parseYouTubeTimedText(text);
    }
    return looksLikeTtml ? parseTTML(text) : parseVTT(text);
  }
  function isSubtitleCandidateUrl(url) {
    return SUBTITLE_URL_RE.test(url) || isLikelyNetflixSubtitleRange(url);
  }
  function isLikelyNetflixSubtitleRange(url) {
    const match = url.match(NETFLIX_RANGE_RE);
    if (!match) {
      return false;
    }
    const start = Number(match[1]);
    const end = Number(match[2]);
    const bytes = end - start + 1;
    return Number.isFinite(bytes) && bytes > 0 && bytes <= MAX_NETFLIX_RANGE_BYTES;
  }
  function isOversizedNetflixRange(url) {
    const match = url.match(NETFLIX_RANGE_RE);
    if (!match) {
      return false;
    }
    const start = Number(match[1]);
    const end = Number(match[2]);
    return end - start + 1 > MAX_NETFLIX_RANGE_BYTES;
  }
  function looksLikeTextSubtitlePayload(text) {
    const sample = String(text || "").slice(0, 1200);
    if (/<(tt|p|text|span|body|div)\b/i.test(sample) || /WEBVTT/i.test(sample) || /-->/i.test(sample) || CHINESE_RE.test(sample)) {
      return true;
    }
    const printable = sample.replace(/[\t\n\r -~\u0080-\uffff]/g, "").length;
    return sample.length > 0 && printable / sample.length < 0.05;
  }
  function parseYouTubeTimedText(text) {
    const raw = String(text || "").trim();
    if (!raw) {
      return [];
    }
    if (raw.startsWith("{") || raw.startsWith("[")) {
      return parseYouTubeJson3(raw);
    }
    return parseYouTubeXml(raw);
  }
  function parseYouTubeJson3(text) {
    try {
      const data = JSON.parse(text);
      return (data.events || []).map((event) => {
        const start = Number(event.tStartMs) / 1e3;
        const duration = Number(event.dDurationMs || 0) / 1e3;
        const cueText = cleanSubtitleText((event.segs || []).map((seg) => seg.utf8 || "").join(""));
        if (!Number.isFinite(start) || !cueText) {
          return null;
        }
        return {
          start,
          end: start + (duration || 2.5),
          text: cueText
        };
      }).filter(Boolean);
    } catch (error) {
      console.debug("Pinyin Captions: failed to parse YouTube JSON captions", error);
      return [];
    }
  }
  function parseYouTubeXml(text) {
    const decoded = decodeHtmlEntities(text);
    return Array.from(decoded.matchAll(/<text\b([^>]*)>([\s\S]*?)<\/text>/gi)).map((match) => {
      const attrs = match[1] || "";
      const start = Number(getXmlAttribute(attrs, "start"));
      const duration = Number(getXmlAttribute(attrs, "dur") || 0);
      const cueText = cleanSubtitleText(match[2] || "");
      if (!Number.isFinite(start) || !cueText) {
        return null;
      }
      return {
        start,
        end: start + (Number.isFinite(duration) && duration > 0 ? duration : 2.5),
        text: cueText
      };
    }).filter(Boolean);
  }
  function parseVTT(text) {
    return String(text || "").replace(/\r/g, "").split(/\n{2,}/).map((block) => {
      const lines = block.split("\n").map((line) => line.trim()).filter(Boolean);
      const timingIndex = lines.findIndex((line) => line.includes("-->"));
      if (timingIndex === -1) {
        return null;
      }
      const [rawStart, rawEnd] = lines[timingIndex].split("-->");
      const start = timestampToSeconds(rawStart.trim());
      const end = timestampToSeconds(rawEnd.trim().split(/\s+/)[0]);
      const cueText = cleanSubtitleText(lines.slice(timingIndex + 1).join(" "));
      if (!Number.isFinite(start) || !Number.isFinite(end) || !cueText) {
        return null;
      }
      return { start, end, text: cueText };
    }).filter(Boolean);
  }
  function parseTTML(text) {
    if (typeof DOMParser === "undefined") {
      return parseTTMLWithRegex(text);
    }
    const parser = new DOMParser();
    const doc = parser.parseFromString(String(text || ""), "text/xml");
    const parseError = doc.querySelector("parsererror");
    if (parseError) {
      return [];
    }
    return Array.from(doc.getElementsByTagName("p")).map((node) => {
      const begin = node.getAttribute("begin");
      const end = node.getAttribute("end");
      const dur = node.getAttribute("dur");
      const start = timestampToSeconds(begin);
      const resolvedEnd = end ? timestampToSeconds(end) : start + timestampToSeconds(dur);
      const cueText = cleanSubtitleText(node.textContent || "");
      if (!Number.isFinite(start) || !Number.isFinite(resolvedEnd) || !cueText) {
        return null;
      }
      return { start, end: resolvedEnd, text: cueText };
    }).filter(Boolean);
  }
  function parseTTMLWithRegex(text) {
    return Array.from(String(text || "").matchAll(/<p\b([^>]*)>([\s\S]*?)<\/p>/gi)).map((match) => {
      const attrs = match[1] || "";
      const body = match[2] || "";
      const begin = getXmlAttribute(attrs, "begin");
      const end = getXmlAttribute(attrs, "end");
      const dur = getXmlAttribute(attrs, "dur");
      const start = timestampToSeconds(begin);
      const resolvedEnd = end ? timestampToSeconds(end) : start + timestampToSeconds(dur);
      const cueText = cleanSubtitleText(body);
      if (!Number.isFinite(start) || !Number.isFinite(resolvedEnd) || !cueText) {
        return null;
      }
      return { start, end: resolvedEnd, text: cueText };
    }).filter(Boolean);
  }
  function getXmlAttribute(attrs, name) {
    const match = attrs.match(new RegExp(`${name}=["']([^"']+)["']`, "i"));
    return match?.[1] || "";
  }
  function timestampToSeconds(value) {
    if (!value) {
      return NaN;
    }
    const raw = String(value).trim();
    const unitMatch = raw.match(/^([\d.]+)\s*(h|m|s|ms)$/i);
    if (unitMatch) {
      const amount = Number(unitMatch[1]);
      const unit = unitMatch[2].toLowerCase();
      if (unit === "h") return amount * 3600;
      if (unit === "m") return amount * 60;
      if (unit === "ms") return amount / 1e3;
      return amount;
    }
    const parts = raw.replace(",", ".").split(":").map(Number);
    if (parts.some(Number.isNaN)) {
      return NaN;
    }
    if (parts.length === 3) {
      return parts[0] * 3600 + parts[1] * 60 + parts[2];
    }
    if (parts.length === 2) {
      return parts[0] * 60 + parts[1];
    }
    return parts[0];
  }
  function cleanSubtitleText(input) {
    return decodeHtmlEntities(String(input || "")).replace(/<\/?(font|i|b|ruby|rt|rp|span|div|br|p|c|v|lang|em|strong)[^>]*>/gi, " ").replace(/<[^>]*>/g, " ").replace(/&nbsp;/gi, " ").replace(/&amp;/gi, "&").replace(/&lt;/gi, "<").replace(/&gt;/gi, ">").replace(/\s+/g, " ").trim();
  }
  function decodeHtmlEntities(input) {
    return String(input || "").replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16))).replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code))).replace(/&nbsp;/gi, " ").replace(/&amp;/gi, "&").replace(/&lt;/gi, "<").replace(/&gt;/gi, ">").replace(/&quot;/gi, '"').replace(/&#39;/g, "'");
  }
  async function getEnabled() {
    const result = await chrome.storage.local.get({ enabled: true });
    return result.enabled !== false;
  }
  async function cacheCues(tabId, cues) {
    const result = await chrome.storage.local.get({ cuesByTab: {} });
    const cuesByTab = result.cuesByTab || {};
    cuesByTab[String(tabId)] = {
      cues,
      cueCount: cues.length,
      loadedAt: Date.now()
    };
    await chrome.storage.local.set({
      cuesByTab,
      cueCount: cues.length,
      status: `${cues.length} cues loaded`
    });
  }
  async function rememberSubtitleCandidate(tabId, url, status) {
    const result = await chrome.storage.local.get({ subtitleDebugByTab: {} });
    const subtitleDebugByTab = result.subtitleDebugByTab || {};
    subtitleDebugByTab[String(tabId)] = {
      url,
      host: safeUrlHost(url),
      status,
      seenAt: Date.now()
    };
    await chrome.storage.local.set({ subtitleDebugByTab });
  }
  function safeUrlHost(url) {
    try {
      return new URL(url).host;
    } catch {
      return "";
    }
  }
})();

# Pinyin Captions

A Chrome extension (Manifest V3) that overlays real-time Pinyin subtitles below the platform's native subtitles on Netflix, YouTube, Amazon Prime Video, and Disney+. Pinyin conversion is fully offline using [pinyin-pro](https://github.com/zh-lx/pinyin-pro) — no paid APIs required.

## How it works

1. Watch with **English subtitles** enabled.
2. A **one-time banner** appears asking you to switch to Chinese subtitles.
3. `background.js` **intercepts the Chinese `.vtt` / `.ttml` network request**, parses the cues, and sends them to the content script.
4. The content script **switches the player back to English** automatically.
5. From then on a **Pinyin overlay** appears below your English subs, synced to `video.currentTime`.

## Supported platforms

| Platform | Subtitle format intercepted |
|---|---|
| Netflix | TTML range requests via `nflxvideo.net` |
| YouTube | `timedtext` JSON3 / XML |
| Amazon Prime Video | VTT / TTML |
| Disney+ / Hotstar | VTT / TTML |

## Install (developer / unpacked)

### 1. Build

```bash
cd pinyin-captions
npm install
npm run build
```

The compiled extension is output to `dist/`.

### 2. Load in Chrome

1. Open `chrome://extensions`
2. Enable **Developer mode** (top-right toggle)
3. Click **Load unpacked** and select the `dist/` folder

## Usage

1. Open a supported streaming platform and start a show/movie.
2. Enable **Chinese (Simplified / Traditional)** subtitles when prompted by the banner.
3. The extension automatically detects the Chinese subtitle file, converts it to Pinyin, then switches your display back to English.
4. Pinyin text appears centered below the English subtitle line.
5. Use the extension **popup** (click the toolbar icon) to toggle Pinyin Captions on/off and see how many cues are loaded for the current tab.

## Project structure

```
pinyin-captions/
├── src/
│   ├── content_script.js   # MutationObserver, overlay, banner, cue sync
│   └── pinyin_converter.js # Wraps pinyin-pro, exports convertToPinyin()
├── background.js           # Service worker: intercepts subtitles, parses, caches
├── popup/
│   ├── popup.html
│   └── popup.js
├── manifest.json           # MV3
├── build.js                # esbuild: bundles src/ + background.js → dist/
└── package.json
```

## Development

```bash
npm run build   # full rebuild into dist/
```

Re-load the unpacked extension in `chrome://extensions` after each build.

## Notes

- Subtitle player controls differ across streaming platforms, so automatic language restoration is best-effort.
- YouTube does not always expose caption tracks as standard `<track>` elements. The extension reads `ytInitialPlayerResponse` in the page to locate the Chinese track URL directly.
- The extension only converts Chinese text after stripping HTML, ruby, and TTML markup.

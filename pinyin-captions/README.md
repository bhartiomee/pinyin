# Pinyin Captions

Pinyin Captions is a Chrome Extension (Manifest V3) that overlays offline Pinyin subtitles below the native captions on supported streaming sites. It uses `pinyin-pro` locally in the extension bundle, so no paid APIs or remote conversion services are needed.

## Supported Platforms

- Netflix
- YouTube
- Amazon Prime Video
- Disney+
- Hotstar

## Install For Development

1. Install dependencies:

   ```sh
   npm install
   ```

2. Build the extension:

   ```sh
   npm run build
   ```

3. Open Chrome and go to `chrome://extensions`.
4. Enable **Developer mode**.
5. Click **Load unpacked**.
6. Select the `dist/` folder inside this project.

## How To Use

1. Open supported Chinese-language content with English subtitles active.
2. When the banner appears, switch the player subtitles to Chinese for a moment.
3. Pinyin Captions watches subtitle network requests and loads the Chinese `.vtt` or `.ttml` cue file.
4. Once cues are loaded, the banner hides automatically and the extension attempts to restore the original subtitle language.
5. Keep watching. Pinyin appears centered below the native subtitle area.

If no Chinese subtitle request is intercepted, the banner stays visible and the page continues normally.

## Popup

The popup lets you turn Pinyin Captions on or off and shows whether cues are loaded for the active tab. Cue metadata is stored in `chrome.storage.local` so the popup can be refreshed without losing status.

## Notes

- Subtitle player controls differ across streaming platforms, so automatic language restoration is best-effort.
- YouTube does not always expose caption tracks as standard `<track>` elements. In those cases, the extension keeps captions enabled and shows a toast reminding you to switch back if needed.
- The extension only converts Chinese text after cleaning common HTML, ruby, and TTML markup.

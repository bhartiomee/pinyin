# Pinyin Captions Chrome Extension

A Chrome extension that overlays offline Pinyin captions below native captions on supported streaming platforms.

## Features

- Real-time Pinyin subtitle generation
- Support for multiple streaming platforms (Netflix, YouTube, Prime Video, Disney+, Hotstar)
- Offline processing - no internet required after installation
- Automatic Chinese subtitle detection

## Project Structure

```
├── main.js                          # Main entry point (JavaScript)
├── package.json                     # NPM configuration
├── pinyin-captions/                 # Chrome extension files
│   ├── background.js               # Service worker for Chrome extension
│   ├── content_script.js           # Content script for subtitle manipulation
│   ├── pinyin_converter.js         # Pinyin conversion utilities
│   ├── build.js                    # Build configuration
│   ├── manifest.json               # Chrome extension manifest
│   ├── package.json                # Extension dependencies
│   ├── popup/                      # Popup UI
│   │   ├── popup.html
│   │   └── popup.js
│   ├── icons/                      # Extension icons
│   └── README.md                   # Extension README
```

## Setup

### Prerequisites

- Node.js 14+ installed
- npm (comes with Node.js)

### Installation

1. Clone the repository
2. Install dependencies:
   ```bash
   npm install
   ```

3. Build the extension:
   ```bash
   npm run build
   ```

## Running the Extension

### Loading in Chrome

1. Open Chrome and go to `chrome://extensions/`
2. Enable "Developer mode" (top right)
3. Click "Load unpacked"
4. Navigate to the `pinyin-captions/dist/` directory and select it

## Development

### Scripts

- `npm run build` - Build the extension
- `npm run dev` - Run the development entry point
- `npm start` - Same as `npm run dev`

### Architecture

- **main.js** - Entry point for the JavaScript-based application
- **background.js** - Service worker that intercepts subtitle requests
- **content_script.js** - Injects pinyin captions into the page
- **pinyin_converter.js** - Converts Chinese characters to Pinyin

## Dependencies

- **pinyin-pro** - Chinese character to Pinyin conversion library
- **esbuild** - Fast JavaScript bundler (dev)
- **pngjs** - PNG image processing (dev)

## Supported Platforms

- Netflix
- YouTube
- Prime Video
- Disney+
- Hotstar

## License

MIT

## Notes

This is a pure JavaScript project. All Java code has been migrated to JavaScript.

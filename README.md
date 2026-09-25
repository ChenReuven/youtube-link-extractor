# YouTube Link Extractor

Manifest V3 Chrome extension that adds a floating button on `youtube.com/watch*` pages. Click it to list all unique HTTP(S) links from the video **description** and **comments** (including deep / lazy-loaded threads via the YouTube Innertube API — no scroll simulation).

## Load unpacked (Chrome / Chromium / Edge)

1. Open `chrome://extensions` (or `edge://extensions`).
2. Enable **Developer mode** (top-right).
3. Click **Load unpacked**.
4. Select this folder:

   ```
   /workspace/youtube-link-extractor
   ```

   (Or the path where you copied this project.)

5. Open any YouTube watch page (`https://www.youtube.com/watch?v=…`).
6. Click the red 🔗 button (bottom-right) to open the popover.

## Features

- Deduplicates links with light normalization (host case, default ports, trailing slash, common `utm_*` / `si` params).
- Sources labeled as `description` or `comment`.
- **Copy all** copies unique URLs (one per line) to the clipboard.
- Links open in a new tab.
- Comment pagination capped at **20** Innertube continuation pages (see `MAX_COMMENT_PAGES` in `src/content.js` and `DEFAULT_MAX_PAGES` in `src/lib/youtubeComments.js`).

## Permissions

Only host permissions for YouTube:

- `https://www.youtube.com/*`
- `https://youtube.com/*`

No `storage`, `tabs`, or broad `<all_urls>` permissions.

## Development / tests

Pure extract/dedupe helpers are in `src/lib/extractLinks.js` and run under Vitest without Chrome:

```bash
cd /workspace/youtube-link-extractor
npm install
npm test
```

## Layout

```
manifest.json
src/content.js          # floating button + popover
src/ui.css
src/lib/extractLinks.js # extractUrls, dedupeUrls, normalizeUrl
src/lib/youtubeComments.js  # Innertube continuations
icons/
tests/extractLinks.test.js
package.json
BUILD_SUMMARY.md
```

## Notes

- Comments are fetched with the page’s `INNERTUBE_API_KEY`, client version, and visitor data from `ytcfg` / embedded page JSON, then walked via `/youtubei/v1/next` continuations.
- Description text is collected from the DOM (`#description`, expanded expander) and from `ytInitialPlayerResponse` / `ytInitialData` when present.

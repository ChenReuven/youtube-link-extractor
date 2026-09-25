# BUILD_SUMMARY — YouTube Link Extractor

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│  YouTube watch page (content script world)              │
│                                                         │
│  content.js                                             │
│    ├─ inject FAB + popover (ui.css)                     │
│    ├─ getDescriptionText()  → DOM + ytInitial*          │
│    ├─ ExtractLinks.extractUrls / mergeLinkRecords       │
│    └─ YouTubeComments.fetchCommentLinks()               │
│         ├─ getInnertubeConfig()  (ytcfg / script parse) │
│         ├─ getInitialCommentsContinuation()             │
│         └─ loop POST /youtubei/v1/next (max 20 pages)   │
└─────────────────────────────────────────────────────────┘
```

- **Zero-build load-unpacked**: plain JS modules loaded as classic content-script files; libraries attach to `globalThis` (`ExtractLinks`, `YouTubeComments`) and also ESM-export for Vitest.
- **No background service worker** required — all work runs in the content script with page credentials (`credentials: 'same-origin'`).
- **Permissions**: host_permissions limited to `https://www.youtube.com/*` and `https://youtube.com/*`.

## Description extraction

1. DOM selectors: `#description-inline-expander`, `#description`, related expanders; collect `innerText` and `a[href]` (resolving `/redirect?q=`).
2. `ytInitialPlayerResponse.videoDetails.shortDescription` and microformat description when available.
3. Shallow walk of `ytInitialData` for `attributedDescriptionText` / description body runs.

## How comments are fetched (Innertube)

**No scroll simulation.** Flow:

1. **Credentials** from `ytcfg.get('INNERTUBE_API_KEY')`, `INNERTUBE_CONTEXT.client` (clientVersion, visitorData), with regex fallbacks over page `<script>` blobs for `INNERTUBE_API_KEY`, `INNERTUBE_CLIENT_VERSION`, `VISITOR_DATA`.
2. **Initial continuation token** discovered by walking `ytInitialData` for `continuationCommand.token` / `nextContinuationData` (comments engagement / itemSection paths). If missing, a priming `POST /youtubei/v1/next` with `videoId` is attempted, then the response is searched for a comments continuation.
3. **Pagination**: for each token, `POST https://www.youtube.com/youtubei/v1/next?key=…` with body `{ context: { client: WEB… }, continuation: token }`, headers `X-YouTube-Client-Name/Version` and optional `X-Goog-Visitor-Id`.
4. **Parse**: recursive walk extracts `commentRenderer` / related text runs and link navigation endpoints; resolve YouTube `/redirect` URLs to the real target; feed text through `extractUrls`.
5. **Cap**: stop after **20** continuation pages (`DEFAULT_MAX_PAGES` / `MAX_COMMENT_PAGES`) or when tokens repeat / are exhausted — avoids infinite loops on long threads.
6. Progress callbacks update the popover status line; errors surface as status messages without crashing the UI.

## Deduplication

`normalizeUrl` lowercases scheme/host, strips default ports, trims trailing path slash when safe, drops light tracking params (`utm_*`, `si`, `feature`). `dedupeUrls` / `mergeLinkRecords` keep the first original string; when the same URL appears in both sources, **description** wins.

## Tests

- `tests/extractLinks.test.js` covers `extractUrls`, `dedupeUrls`, `normalizeUrl`, `mergeLinkRecords`.
- Run: `npm install && npm test` (Vitest, Node environment — no Chrome).

## Icons

Minimal generated PNGs (`icons/icon{16,48,128}.png`) — solid dark background with a red disc placeholder.

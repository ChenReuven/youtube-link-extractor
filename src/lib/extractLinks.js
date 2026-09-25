/**
 * Pure helpers: extract and deduplicate HTTP(S) URLs from text.
 * Usable in content scripts (global) and in Node/Vitest (ESM export).
 */

const URL_RE =
  /https?:\/\/(?:www\.)?[-a-zA-Z0-9@:%._+~#=]{1,256}\.[a-zA-Z0-9()]{1,6}\b(?:[-a-zA-Z0-9()@:%_+.~#?&/=]*)/gi;

/** Strip common trailing punctuation that is not part of the URL. */
function trimTrailingPunctuation(url) {
  return url.replace(/[),.;:!?'"\]]+$/g, '');
}

/**
 * Normalize a URL for deduplication while keeping distinct destinations.
 * - lowercase scheme + host
 * - remove default ports
 * - remove trailing slash on path-only URLs (keep query/hash)
 * - strip common tracking params (optional light touch)
 */
function normalizeUrl(raw) {
  let url = trimTrailingPunctuation(String(raw).trim());
  try {
    const u = new URL(url);
    u.protocol = u.protocol.toLowerCase();
    u.hostname = u.hostname.toLowerCase();
    if (
      (u.protocol === 'http:' && u.port === '80') ||
      (u.protocol === 'https:' && u.port === '443')
    ) {
      u.port = '';
    }
    // Drop fragment for dedupe key (same resource)
    const hash = u.hash;
    u.hash = '';
    let path = u.pathname;
    if (path.length > 1 && path.endsWith('/')) {
      path = path.slice(0, -1);
    }
    u.pathname = path || '/';
    // Light tracking scrub — keep other query params
    const drop = new Set([
      'utm_source',
      'utm_medium',
      'utm_campaign',
      'utm_term',
      'utm_content',
      'si',
      'feature',
    ]);
    [...u.searchParams.keys()].forEach((k) => {
      if (drop.has(k.toLowerCase())) u.searchParams.delete(k);
    });
    // Prefer href without empty search; re-attach hash only for display elsewhere
    let out = u.toString();
    if (out.endsWith('/') && u.search === '' && path === '/') {
      // leave root as-is
    } else if (out.endsWith('/') && u.pathname !== '/' && u.search === '') {
      out = out.slice(0, -1);
    }
    void hash;
    return out;
  } catch {
    return url.toLowerCase();
  }
}

/**
 * Extract unique HTTP(S) URLs from arbitrary text.
 * @param {string} text
 * @returns {string[]} original-ish URLs (first occurrence form), deduped by normalizeUrl
 */
function extractUrls(text) {
  if (!text || typeof text !== 'string') return [];
  const found = text.match(URL_RE) || [];
  return dedupeUrls(found.map(trimTrailingPunctuation));
}

/**
 * Deduplicate a list of URLs using normalizeUrl as the key.
 * Keeps the first occurrence's original string (after trailing-punct trim).
 * @param {string[]} urls
 * @returns {string[]}
 */
function dedupeUrls(urls) {
  if (!Array.isArray(urls)) return [];
  const seen = new Map();
  for (const raw of urls) {
    if (!raw || typeof raw !== 'string') continue;
    const trimmed = trimTrailingPunctuation(raw.trim());
    if (!/^https?:\/\//i.test(trimmed)) continue;
    const key = normalizeUrl(trimmed);
    if (!seen.has(key)) {
      seen.set(key, trimmed);
    }
  }
  return [...seen.values()];
}

/**
 * Merge link records { url, source } with dedupe by normalized URL.
 * Prefer keeping 'description' over 'comment' when same URL appears in both.
 * @param {Array<{url: string, source: string}>} items
 * @returns {Array<{url: string, source: string}>}
 */
function mergeLinkRecords(items) {
  if (!Array.isArray(items)) return [];
  const map = new Map();
  const priority = { description: 2, comment: 1 };
  for (const item of items) {
    if (!item || !item.url) continue;
    const trimmed = trimTrailingPunctuation(String(item.url).trim());
    if (!/^https?:\/\//i.test(trimmed)) continue;
    const key = normalizeUrl(trimmed);
    const source = item.source === 'description' ? 'description' : 'comment';
    const existing = map.get(key);
    if (!existing) {
      map.set(key, { url: trimmed, source });
    } else if ((priority[source] || 0) > (priority[existing.source] || 0)) {
      map.set(key, { url: trimmed, source });
    }
  }
  return [...map.values()];
}

// Attach to globalThis for content scripts and Vitest
const ExtractLinks = {
  URL_RE,
  trimTrailingPunctuation,
  normalizeUrl,
  extractUrls,
  dedupeUrls,
  mergeLinkRecords,
};

if (typeof globalThis !== 'undefined') {
  globalThis.ExtractLinks = ExtractLinks;
}


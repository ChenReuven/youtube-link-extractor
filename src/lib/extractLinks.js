/**
 * Pure helpers: extract and deduplicate HTTP(S) URLs from text.
 * Usable in content scripts (global) and in Node/Vitest (ESM export).
 */

const URL_RE =
  /https?:\/\/(?:www\.)?[-a-zA-Z0-9@:%._+~#=]{1,256}\.[a-zA-Z0-9()]{1,6}\b(?:[-a-zA-Z0-9()@:%_+.~#?&/=]*)/gi;

const DESC_MAX = 120;

/** Strip common trailing punctuation that is not part of the URL. */
function trimTrailingPunctuation(url) {
  return url.replace(/[),.;:!?'"\]]+$/g, '');
}

/**
 * Trim, collapse whitespace, and cap length for stored descriptions.
 * @param {unknown} text
 * @returns {string}
 */
function sanitizeDescription(text) {
  if (text == null) return '';
  return String(text).trim().replace(/\s+/g, ' ').slice(0, DESC_MAX);
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
 * Whether text is a useful human label for a URL (not empty, not the URL itself).
 * Trims / collapses whitespace; storage length is capped at ~120 chars.
 * @param {unknown} text
 * @param {string} [url]
 * @returns {boolean}
 */
function isUsefulDescription(text, url) {
  const cleaned = sanitizeDescription(text);
  if (cleaned.length < 2) return false;
  const u = String(url || '').trim();
  if (!u) return true;
  if (cleaned.toLowerCase() === u.toLowerCase()) return false;
  // Trivial differences: trailing slash / punctuation only
  const trivial = (s) =>
    s
      .toLowerCase()
      .replace(/[),.;:!?'"\]]+$/g, '')
      .replace(/\/+$/g, '');
  if (trivial(cleaned) === trivial(u)) return false;
  return true;
}

/**
 * Preceding label on a single line that contains url.
 * Strips the url occurrence and trailing : - – — | separators.
 * @param {string} line
 * @param {string} url
 * @returns {string|null}
 */
function labelBeforeUrl(line, url) {
  if (!line || typeof line !== 'string' || !url) return null;
  const idx = line.indexOf(url);
  if (idx === -1) return null;
  let before = line.slice(0, idx);
  // Strip trailing whitespace and label separators
  before = before.replace(/[\s:\-–—|]+$/u, '').trim();
  if (!isUsefulDescription(before, url)) return null;
  return sanitizeDescription(before);
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
 * Scan text for HTTP(S) URLs and optional same-line labels.
 * @param {string} text
 * @param {'description'|'comment'} source
 * @returns {Array<{url: string, source: string, description?: string}>}
 */
function extractLinkRecordsFromText(text, source) {
  if (!text || typeof text !== 'string') return [];
  const src = source === 'description' ? 'description' : 'comment';
  const records = [];
  const lines = text.split(/\r?\n/);
  for (const line of lines) {
    const matches = line.match(URL_RE) || [];
    for (const raw of matches) {
      const url = trimTrailingPunctuation(raw);
      if (!/^https?:\/\//i.test(url)) continue;
      const label =
        labelBeforeUrl(line, raw) ||
        (raw !== url ? labelBeforeUrl(line, url) : null);
      const rec = { url, source: src };
      if (label) rec.description = label;
      records.push(rec);
    }
  }
  return records;
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
 * Pick the better useful description (non-empty useful wins; else keep current).
 * @param {string|undefined} current
 * @param {string|undefined} incoming
 * @param {string} url
 * @returns {string|undefined}
 */
function preferDescription(current, incoming, url) {
  const next =
    incoming != null && isUsefulDescription(incoming, url)
      ? sanitizeDescription(incoming)
      : undefined;
  const prev =
    current != null && isUsefulDescription(current, url)
      ? sanitizeDescription(current)
      : undefined;
  if (next && !prev) return next;
  if (prev) return prev;
  return next;
}

/**
 * Merge link records { url, source, description? } with dedupe by normalized URL.
 * Prefer keeping 'description' over 'comment' when same URL appears in both.
 * Prefer non-empty useful description over empty; equal priority keeps first url.
 * @param {Array<{url: string, source: string, description?: string}>} items
 * @returns {Array<{url: string, source: string, description?: string}>}
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
    const incomingDesc =
      item.description != null && isUsefulDescription(item.description, trimmed)
        ? sanitizeDescription(item.description)
        : undefined;
    const existing = map.get(key);
    if (!existing) {
      const rec = { url: trimmed, source };
      if (incomingDesc) rec.description = incomingDesc;
      map.set(key, rec);
      continue;
    }
    const existingPri = priority[existing.source] || 0;
    const newPri = priority[source] || 0;
    if (newPri > existingPri) {
      const rec = { url: trimmed, source };
      const desc = preferDescription(existing.description, incomingDesc, trimmed);
      if (desc) rec.description = desc;
      map.set(key, rec);
    } else {
      // Equal or lower priority: keep existing url + source; upgrade description if better
      const desc = preferDescription(
        existing.description,
        incomingDesc,
        existing.url
      );
      if (desc) {
        existing.description = desc;
      } else {
        delete existing.description;
      }
    }
  }
  return [...map.values()];
}

/**
 * Format a record for clipboard copy.
 * @param {{url: string, description?: string}} record
 * @returns {string}
 */
function formatCopyLine({ url, description } = {}) {
  const u = url || '';
  if (isUsefulDescription(description, u)) {
    return `${sanitizeDescription(description)} — ${u}`;
  }
  return u;
}

// Attach to globalThis for content scripts and Vitest
const ExtractLinks = {
  URL_RE,
  trimTrailingPunctuation,
  normalizeUrl,
  extractUrls,
  dedupeUrls,
  mergeLinkRecords,
  sanitizeDescription,
  isUsefulDescription,
  labelBeforeUrl,
  extractLinkRecordsFromText,
  formatCopyLine,
};

if (typeof globalThis !== 'undefined') {
  globalThis.ExtractLinks = ExtractLinks;
}

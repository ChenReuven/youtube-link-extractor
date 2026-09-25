/**
 * YouTube Innertube comment-thread fetch + URL extraction.
 * Uses page credentials from ytcfg / ytInitialData (no simulated scroll).
 */

const DEFAULT_MAX_PAGES = 20;

/**
 * Read Innertube config from the watch page (ytcfg or embedded scripts).
 * @returns {{ apiKey: string, clientVersion: string, clientName: string, visitorData: string } | null}
 */
function getInnertubeConfig() {
  try {
    const ytcfg = globalThis.ytcfg;
    if (ytcfg && typeof ytcfg.get === 'function') {
      const apiKey = ytcfg.get('INNERTUBE_API_KEY');
      const context = ytcfg.get('INNERTUBE_CONTEXT') || {};
      const client = context.client || {};
      const visitorData =
        client.visitorData ||
        ytcfg.get('VISITOR_DATA') ||
        '';
      if (apiKey) {
        return {
          apiKey,
          clientVersion: client.clientVersion || ytcfg.get('INNERTUBE_CLIENT_VERSION') || '',
          clientName: String(client.clientName || 'WEB'),
          visitorData,
        };
      }
    }
  } catch {
    /* fall through */
  }

  // Fallback: parse from script tags / ytcfg.set JSON blobs
  try {
    const scripts = document.querySelectorAll('script');
    let apiKey = '';
    let clientVersion = '';
    let visitorData = '';
    const keyRe = /"INNERTUBE_API_KEY"\s*:\s*"([^"]+)"/;
    const verRe = /"INNERTUBE_CLIENT_VERSION"\s*:\s*"([^"]+)"/;
    const visRe = /"VISITOR_DATA"\s*:\s*"([^"]+)"/;
    const ver2Re = /"clientVersion"\s*:\s*"([^"]+)"/;
    for (const s of scripts) {
      const t = s.textContent || '';
      if (!apiKey) {
        const m = t.match(keyRe);
        if (m) apiKey = m[1];
      }
      if (!clientVersion) {
        const m = t.match(verRe) || t.match(ver2Re);
        if (m) clientVersion = m[1];
      }
      if (!visitorData) {
        const m = t.match(visRe);
        if (m) visitorData = m[1];
      }
      if (apiKey && clientVersion) break;
    }
    if (apiKey) {
      return {
        apiKey,
        clientVersion: clientVersion || '2.0',
        clientName: 'WEB',
        visitorData,
      };
    }
  } catch {
    /* ignore */
  }
  return null;
}

/**
 * Build a WEB client context for Innertube POSTs.
 */
function buildContext(cfg) {
  return {
    client: {
      clientName: cfg.clientName || 'WEB',
      clientVersion: cfg.clientVersion || '2.0',
      visitorData: cfg.visitorData || undefined,
      hl: document.documentElement.lang || 'en',
      gl: 'US',
    },
  };
}

/**
 * Find the first comments continuation token from ytInitialData.
 */
function findCommentsContinuation(data, depth = 0) {
  if (!data || depth > 40) return null;
  if (typeof data === 'string') {
    // continuation tokens are long base64-ish; only accept via structured fields
    return null;
  }
  if (Array.isArray(data)) {
    for (const item of data) {
      const found = findCommentsContinuation(item, depth + 1);
      if (found) return found;
    }
    return null;
  }
  if (typeof data === 'object') {
    // Prefer engagement-panel / itemSection continuations related to comments
    if (data.continuationCommand && data.continuationCommand.token) {
      return data.continuationCommand.token;
    }
    if (
      data.nextContinuationData &&
      data.nextContinuationData.continuation
    ) {
      return data.nextContinuationData.continuation;
    }
    // Walk known comment paths first
    const preferKeys = [
      'engagementPanels',
      'itemSectionRenderer',
      'contents',
      'continuationItemRenderer',
      'buttonRenderer',
      'command',
    ];
    for (const k of preferKeys) {
      if (k in data) {
        const found = findCommentsContinuation(data[k], depth + 1);
        if (found) return found;
      }
    }
    for (const k of Object.keys(data)) {
      if (preferKeys.includes(k)) continue;
      const found = findCommentsContinuation(data[k], depth + 1);
      if (found) return found;
    }
  }
  return null;
}

/**
 * More targeted search: comments section continuation from ytInitialData.
 */
function getInitialCommentsContinuation() {
  const initial =
    globalThis.ytInitialData ||
    (typeof window !== 'undefined' ? window.ytInitialData : null);
  if (!initial) {
    // Try parse from script
    try {
      const scripts = document.querySelectorAll('script');
      for (const s of scripts) {
        const t = s.textContent || '';
        const marker = 'var ytInitialData = ';
        const idx = t.indexOf(marker);
        if (idx === -1) continue;
        const start = idx + marker.length;
        const end = t.indexOf(';</script>', start);
        const jsonEnd = end === -1 ? t.indexOf(';', start) : end;
        const json = t.slice(start, jsonEnd);
        try {
          return findCommentsContinuation(JSON.parse(json));
        } catch {
          /* continue */
        }
      }
    } catch {
      /* ignore */
    }
    return null;
  }
  return findCommentsContinuation(initial);
}

/**
 * Flatten runs / text objects into a single string.
 */
function runsToText(runs) {
  if (!runs) return '';
  if (typeof runs === 'string') return runs;
  if (!Array.isArray(runs)) {
    if (runs.text) return String(runs.text);
    if (runs.simpleText) return String(runs.simpleText);
    return '';
  }
  return runs
    .map((r) => {
      if (!r) return '';
      if (typeof r === 'string') return r;
      if (r.text) return r.text;
      if (r.navigationEndpoint?.urlEndpoint?.url) {
        return r.navigationEndpoint.urlEndpoint.url;
      }
      if (r.navigationEndpoint?.commandMetadata?.webCommandMetadata?.url) {
        const path = r.navigationEndpoint.commandMetadata.webCommandMetadata.url;
        if (path.startsWith('http')) return path;
        // YouTube often wraps external links as /redirect?q=
        return path.startsWith('/') ? `https://www.youtube.com${path}` : path;
      }
      return '';
    })
    .join('');
}

/**
 * Resolve YouTube redirect URLs to the real target when possible.
 */
function resolvePossiblyRedirectedUrl(url) {
  try {
    const u = new URL(url, 'https://www.youtube.com');
    if (
      u.hostname.endsWith('youtube.com') &&
      (u.pathname === '/redirect' || u.pathname.endsWith('/redirect'))
    ) {
      const q = u.searchParams.get('q') || u.searchParams.get('redir_url');
      if (q) return decodeURIComponent(q);
    }
    return u.href;
  } catch {
    return url;
  }
}

/**
 * Walk a next/continuation response and collect comment text + next token.
 */
function parseCommentResponse(json) {
  const texts = [];
  let nextToken = null;

  function walk(node, depth = 0) {
    if (!node || depth > 50) return;
    if (Array.isArray(node)) {
      node.forEach((n) => walk(n, depth + 1));
      return;
    }
    if (typeof node !== 'object') return;

    // comment text
    const cr =
      node.commentRenderer ||
      node.commentViewModel ||
      node.commentEntityPayload;
    if (node.commentRenderer) {
      const c = node.commentRenderer;
      const content =
        runsToText(c.contentText?.runs) ||
        runsToText(c.contentText) ||
        '';
      if (content) texts.push(content);
      // also pull explicit link endpoints from runs
      const runs = c.contentText?.runs || [];
      for (const r of runs) {
        const ep = r?.navigationEndpoint;
        const raw =
          ep?.urlEndpoint?.url ||
          ep?.commandMetadata?.webCommandMetadata?.url;
        if (raw) texts.push(resolvePossiblyRedirectedUrl(raw));
      }
    }

    // mutation / framework payloads sometimes nest differently
    if (node.content?.content) {
      texts.push(String(node.content.content));
    }
    if (node.properties?.content?.content) {
      texts.push(String(node.properties.content.content));
    }

    // next continuation
    if (node.continuationItemRenderer) {
      const cir = node.continuationItemRenderer;
      const token =
        cir.continuationEndpoint?.continuationCommand?.token ||
        cir.button?.buttonRenderer?.command?.continuationCommand?.token ||
        null;
      if (token) nextToken = token;
    }
    if (node.continuationCommand?.token) {
      nextToken = node.continuationCommand.token;
    }

    for (const k of Object.keys(node)) {
      walk(node[k], depth + 1);
    }
  }

  walk(json);
  return { texts, nextToken };
}

/**
 * POST to Innertube next endpoint with a continuation token.
 */
async function fetchContinuation(cfg, token) {
  const url = `https://www.youtube.com/youtubei/v1/next?key=${encodeURIComponent(cfg.apiKey)}`;
  const body = {
    context: buildContext(cfg),
    continuation: token,
  };
  const headers = {
    'Content-Type': 'application/json',
    'X-YouTube-Client-Name': '1',
    'X-YouTube-Client-Version': cfg.clientVersion || '2.0',
  };
  if (cfg.visitorData) {
    headers['X-Goog-Visitor-Id'] = cfg.visitorData;
  }
  const res = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
    credentials: 'same-origin',
  });
  if (!res.ok) {
    throw new Error(`Innertube next failed: HTTP ${res.status}`);
  }
  return res.json();
}

/**
 * Fetch comment threads via continuations and extract URL strings.
 * Cap at maxPages continuations (default 20).
 *
 * @param {object} options
 * @param {number} [options.maxPages=20]
 * @param {(info:{page:number,totalTexts:number})=>void} [options.onProgress]
 * @returns {Promise<{urls: string[], pages: number, error?: string}>}
 */
async function fetchCommentLinks(options = {}) {
  const maxPages = options.maxPages ?? DEFAULT_MAX_PAGES;
  const onProgress = options.onProgress;
  const extractUrls =
    (globalThis.ExtractLinks && globalThis.ExtractLinks.extractUrls) ||
    (() => []);

  const cfg = getInnertubeConfig();
  if (!cfg || !cfg.apiKey) {
    return {
      urls: [],
      pages: 0,
      error: 'Could not read Innertube credentials from the page (ytcfg).',
    };
  }

  let token = getInitialCommentsContinuation();
  if (!token) {
    // Try priming comments by requesting next with videoId context
    const videoId = new URLSearchParams(location.search).get('v');
    if (!videoId) {
      return {
        urls: [],
        pages: 0,
        error: 'No comments continuation token found on this page.',
      };
    }
    try {
      const url = `https://www.youtube.com/youtubei/v1/next?key=${encodeURIComponent(cfg.apiKey)}`;
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-YouTube-Client-Name': '1',
          'X-YouTube-Client-Version': cfg.clientVersion || '2.0',
          ...(cfg.visitorData ? { 'X-Goog-Visitor-Id': cfg.visitorData } : {}),
        },
        body: JSON.stringify({
          context: buildContext(cfg),
          videoId,
        }),
        credentials: 'same-origin',
      });
      if (res.ok) {
        const json = await res.json();
        token = findCommentsContinuation(json);
      }
    } catch (e) {
      return {
        urls: [],
        pages: 0,
        error: `Failed to prime comments: ${e.message || e}`,
      };
    }
  }

  if (!token) {
    return {
      urls: [],
      pages: 0,
      error: 'Comments are unavailable or not loaded for this video.',
    };
  }

  const allUrls = [];
  let pages = 0;
  let totalTexts = 0;
  const seenTokens = new Set();

  try {
    while (token && pages < maxPages) {
      if (seenTokens.has(token)) break;
      seenTokens.add(token);
      const json = await fetchContinuation(cfg, token);
      pages += 1;
      const { texts, nextToken } = parseCommentResponse(json);
      totalTexts += texts.length;
      for (const text of texts) {
        const resolved = text.includes('/redirect')
          ? resolvePossiblyRedirectedUrl(text)
          : text;
        // Expand redirect q= inside free text too
        const expanded = resolved.replace(
          /https?:\/\/(?:www\.)?youtube\.com\/redirect\?[^\s]+/gi,
          (m) => resolvePossiblyRedirectedUrl(m)
        );
        allUrls.push(...extractUrls(expanded));
        // If the whole "text" is itself a URL (from endpoint), include it
        if (/^https?:\/\//i.test(resolved.trim())) {
          allUrls.push(resolved.trim());
        }
      }
      if (onProgress) onProgress({ page: pages, totalTexts });
      token = nextToken;
      if (!token) break;
    }
  } catch (e) {
    return {
      urls: allUrls,
      pages,
      error: e.message || String(e),
    };
  }

  const dedupe =
    (globalThis.ExtractLinks && globalThis.ExtractLinks.dedupeUrls) ||
    ((a) => [...new Set(a)]);
  return { urls: dedupe(allUrls), pages, maxPages };
}

const YouTubeComments = {
  DEFAULT_MAX_PAGES,
  getInnertubeConfig,
  getInitialCommentsContinuation,
  findCommentsContinuation,
  runsToText,
  resolvePossiblyRedirectedUrl,
  parseCommentResponse,
  fetchCommentLinks,
};

if (typeof globalThis !== 'undefined') {
  globalThis.YouTubeComments = YouTubeComments;
}


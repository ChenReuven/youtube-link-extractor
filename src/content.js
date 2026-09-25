/**
 * YouTube Link Extractor — content script
 * Floating button + popover on youtube.com/watch*
 */
(function () {
  'use strict';

  const ROOT_ID = 'yle-root';
  const MAX_COMMENT_PAGES = 20;

  function $(sel, root = document) {
    return root.querySelector(sel);
  }

  /** Description text from DOM and/or ytInitial* blobs. */
  function getDescriptionText() {
    const chunks = [];

    // Expanded / collapsed description in modern YouTube UI
    const selectors = [
      '#description-inline-expander',
      '#description',
      'ytd-text-inline-expander#description-inline-expander',
      '#info-container #description',
      'ytd-expander#description',
      '#meta-contents #description',
    ];
    for (const sel of selectors) {
      const el = $(sel);
      if (el && el.innerText) chunks.push(el.innerText);
    }

    // Anchor hrefs inside description (YouTube often uses /redirect)
    const descRoot =
      $('#description-inline-expander') ||
      $('#description') ||
      $('ytd-video-secondary-info-renderer');
    if (descRoot) {
      descRoot.querySelectorAll('a[href]').forEach((a) => {
        const href = a.href || a.getAttribute('href');
        if (href) {
          const resolved =
            globalThis.YouTubeComments?.resolvePossiblyRedirectedUrl?.(href) ||
            href;
          chunks.push(resolved);
        }
      });
    }

    // ytInitialPlayerResponse / ytInitialData
    try {
      const pr =
        globalThis.ytInitialPlayerResponse ||
        window.ytInitialPlayerResponse;
      const short =
        pr?.videoDetails?.shortDescription ||
        pr?.microformat?.playerMicroformatRenderer?.description?.simpleText;
      if (short) chunks.push(short);
    } catch {
      /* ignore */
    }

    try {
      const data = globalThis.ytInitialData || window.ytInitialData;
      const mf =
        data?.microformat?.playerMicroformatRenderer?.description
          ?.simpleText;
      if (mf) chunks.push(mf);

      // Walk for videoSecondaryInfoRenderer atrributedDescription
      const walk = (n, d = 0) => {
        if (!n || d > 25) return;
        if (Array.isArray(n)) return n.forEach((x) => walk(x, d + 1));
        if (typeof n !== 'object') return;
        if (n.attributedDescriptionText?.content) {
          chunks.push(n.attributedDescriptionText.content);
        }
        if (n.expandedDescriptionBodyText) {
          const t =
            globalThis.YouTubeComments?.runsToText?.(
              n.expandedDescriptionBodyText.runs ||
                n.expandedDescriptionBodyText
            ) || '';
          if (t) chunks.push(t);
        }
        if (n.descriptionBodyText) {
          const t =
            globalThis.YouTubeComments?.runsToText?.(
              n.descriptionBodyText.runs || n.descriptionBodyText
            ) || '';
          if (t) chunks.push(t);
        }
        for (const k of Object.keys(n)) walk(n[k], d + 1);
      };
      walk(data);
    } catch {
      /* ignore */
    }

    return chunks.join('\n');
  }

  function ensureRoot() {
    let root = document.getElementById(ROOT_ID);
    if (root) return root;
    root = document.createElement('div');
    root.id = ROOT_ID;
    root.innerHTML = `
      <button type="button" class="yle-fab" id="yle-fab" title="Extract links" aria-label="Extract YouTube links">
        <span class="yle-fab-icon">🔗</span>
      </button>
      <div class="yle-popover" id="yle-popover" hidden role="dialog" aria-label="Extracted links">
        <div class="yle-header">
          <strong>YouTube Link Extractor</strong>
          <button type="button" class="yle-close" id="yle-close" aria-label="Close">×</button>
        </div>
        <div class="yle-toolbar">
          <button type="button" class="yle-btn" id="yle-refresh">Refresh</button>
          <button type="button" class="yle-btn yle-btn-primary" id="yle-copy" disabled>Copy all</button>
        </div>
        <div class="yle-status" id="yle-status"></div>
        <ul class="yle-list" id="yle-list"></ul>
      </div>
    `;
    document.documentElement.appendChild(root);
    return root;
  }

  function setStatus(msg, isError = false) {
    const el = document.getElementById('yle-status');
    if (!el) return;
    el.textContent = msg || '';
    el.classList.toggle('yle-error', !!isError);
  }

  function renderList(records) {
    const list = document.getElementById('yle-list');
    const copyBtn = document.getElementById('yle-copy');
    if (!list) return;
    list.innerHTML = '';
    if (!records.length) {
      list.innerHTML = '<li class="yle-empty">No links found.</li>';
      if (copyBtn) copyBtn.disabled = true;
      return;
    }
    if (copyBtn) copyBtn.disabled = false;
    const frag = document.createDocumentFragment();
    for (const { url, source } of records) {
      const li = document.createElement('li');
      li.className = 'yle-item';
      const a = document.createElement('a');
      a.href = url;
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      a.textContent = url;
      a.className = 'yle-link';
      const badge = document.createElement('span');
      badge.className = `yle-badge yle-badge-${source}`;
      badge.textContent = source;
      li.appendChild(badge);
      li.appendChild(a);
      frag.appendChild(li);
    }
    list.appendChild(frag);
  }

  let lastRecords = [];
  let loading = false;

  async function collectLinks() {
    if (loading) return;
    loading = true;
    setStatus('Loading description & comments…');
    renderList([]);
    const copyBtn = document.getElementById('yle-copy');
    if (copyBtn) copyBtn.disabled = true;

    const { extractUrls, mergeLinkRecords } = globalThis.ExtractLinks || {};
    const { fetchCommentLinks } = globalThis.YouTubeComments || {};

    const records = [];

    try {
      const descText = getDescriptionText();
      const descUrls = extractUrls ? extractUrls(descText) : [];
      for (const url of descUrls) {
        records.push({ url, source: 'description' });
      }
      setStatus(
        `Description: ${descUrls.length} link(s). Fetching comments (max ${MAX_COMMENT_PAGES} pages)…`
      );

      let commentResult = { urls: [], pages: 0 };
      if (fetchCommentLinks) {
        commentResult = await fetchCommentLinks({
          maxPages: MAX_COMMENT_PAGES,
          onProgress: ({ page, totalTexts }) => {
            setStatus(
              `Comments: page ${page}/${MAX_COMMENT_PAGES} (${totalTexts} comments scanned)…`
            );
          },
        });
      }

      for (const url of commentResult.urls || []) {
        records.push({ url, source: 'comment' });
      }

      lastRecords = mergeLinkRecords
        ? mergeLinkRecords(records)
        : records;

      let msg = `${lastRecords.length} unique link(s)`;
      msg += ` · comments: ${commentResult.pages || 0} page(s)`;
      if (commentResult.error) {
        setStatus(`${msg}. Warning: ${commentResult.error}`, true);
      } else {
        setStatus(msg);
      }
      renderList(lastRecords);
    } catch (e) {
      setStatus(`Error: ${e.message || e}`, true);
      renderList([]);
    } finally {
      loading = false;
    }
  }

  function openPopover() {
    const pop = document.getElementById('yle-popover');
    if (!pop) return;
    pop.hidden = false;
    collectLinks();
  }

  function closePopover() {
    const pop = document.getElementById('yle-popover');
    if (pop) pop.hidden = true;
  }

  function copyAll() {
    const text = lastRecords.map((r) => r.url).join('\n');
    if (!text) return;
    navigator.clipboard.writeText(text).then(
      () => setStatus(`Copied ${lastRecords.length} link(s) to clipboard.`),
      () => {
        // Fallback
        const ta = document.createElement('textarea');
        ta.value = text;
        document.body.appendChild(ta);
        ta.select();
        try {
          document.execCommand('copy');
          setStatus(`Copied ${lastRecords.length} link(s) to clipboard.`);
        } catch {
          setStatus('Copy failed.', true);
        }
        ta.remove();
      }
    );
  }

  function wire() {
    ensureRoot();
    const fab = document.getElementById('yle-fab');
    const close = document.getElementById('yle-close');
    const refresh = document.getElementById('yle-refresh');
    const copy = document.getElementById('yle-copy');
    fab?.addEventListener('click', () => {
      const pop = document.getElementById('yle-popover');
      if (pop && !pop.hidden) closePopover();
      else openPopover();
    });
    close?.addEventListener('click', closePopover);
    refresh?.addEventListener('click', () => collectLinks());
    copy?.addEventListener('click', copyAll);
  }

  // YouTube is an SPA — reinject on navigation
  let lastHref = location.href;
  function onNavigate() {
    if (location.href === lastHref) return;
    lastHref = location.href;
    closePopover();
    if (!location.pathname.startsWith('/watch')) {
      document.getElementById(ROOT_ID)?.remove();
      return;
    }
    wire();
  }

  const mo = new MutationObserver(() => onNavigate());
  mo.observe(document.documentElement, { childList: true, subtree: true });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', wire);
  } else {
    wire();
  }
})();

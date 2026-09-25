import { describe, it, expect, beforeAll } from 'vitest';

beforeAll(async () => {
  await import('../src/lib/extractLinks.js');
});

function api() {
  return globalThis.ExtractLinks;
}

describe('trimTrailingPunctuation', () => {
  it('strips trailing punctuation', () => {
    const { trimTrailingPunctuation } = api();
    expect(trimTrailingPunctuation('https://a.com/x.')).toBe('https://a.com/x');
    expect(trimTrailingPunctuation('https://a.com/x),')).toBe('https://a.com/x');
  });
});

describe('normalizeUrl', () => {
  it('lowercases host and scheme', () => {
    expect(api().normalizeUrl('HTTPS://Example.COM/Path')).toBe(
      'https://example.com/Path'
    );
  });

  it('removes default ports', () => {
    expect(api().normalizeUrl('https://ex.com:443/a')).toBe('https://ex.com/a');
    expect(api().normalizeUrl('http://ex.com:80/a')).toBe('http://ex.com/a');
  });

  it('drops common tracking params', () => {
    const n = api().normalizeUrl(
      'https://ex.com/p?utm_source=yt&id=1&si=abc'
    );
    expect(n).toContain('id=1');
    expect(n).not.toContain('utm_source');
    expect(n).not.toContain('si=');
  });
});

describe('extractUrls', () => {
  it('returns empty for empty/non-string', () => {
    const { extractUrls } = api();
    expect(extractUrls('')).toEqual([]);
    expect(extractUrls(null)).toEqual([]);
    expect(extractUrls(undefined)).toEqual([]);
  });

  it('extracts http and https URLs from prose', () => {
    const text =
      'See https://example.com/a and also http://foo.io/b?x=1 for more.';
    const urls = api().extractUrls(text);
    expect(urls).toHaveLength(2);
    expect(urls[0]).toMatch(/^https:\/\/example\.com\/a/);
    expect(urls[1]).toMatch(/^http:\/\/foo\.io\/b/);
  });

  it('dedupes equivalent URLs in one pass', () => {
    const text =
      'https://Example.com/x https://example.com/x/ https://example.com/x?utm_source=a';
    const urls = api().extractUrls(text);
    expect(urls).toHaveLength(1);
  });

  it('keeps distinct paths', () => {
    const text = 'https://a.com/1 https://a.com/2';
    expect(api().extractUrls(text)).toHaveLength(2);
  });
});

describe('dedupeUrls', () => {
  it('handles non-arrays', () => {
    expect(api().dedupeUrls(null)).toEqual([]);
    expect(api().dedupeUrls(undefined)).toEqual([]);
  });

  it('keeps first occurrence form', () => {
    const out = api().dedupeUrls([
      'https://Example.com/Path',
      'https://example.com/Path/',
      'https://example.com/Path?utm_medium=x',
    ]);
    expect(out).toHaveLength(1);
    expect(out[0]).toBe('https://Example.com/Path');
  });

  it('skips non-http schemes', () => {
    expect(
      api().dedupeUrls(['ftp://x.com', 'javascript:alert(1)', 'https://ok.com'])
    ).toEqual(['https://ok.com']);
  });
});

describe('mergeLinkRecords', () => {
  it('prefers description over comment for same URL', () => {
    const merged = api().mergeLinkRecords([
      { url: 'https://a.com/x', source: 'comment' },
      { url: 'https://a.com/x/', source: 'description' },
    ]);
    expect(merged).toHaveLength(1);
    expect(merged[0].source).toBe('description');
  });

  it('keeps distinct URLs with their sources', () => {
    const merged = api().mergeLinkRecords([
      { url: 'https://a.com/1', source: 'description' },
      { url: 'https://a.com/2', source: 'comment' },
    ]);
    expect(merged).toHaveLength(2);
  });
});

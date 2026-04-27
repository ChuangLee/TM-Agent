/**
 * URL construction helpers that respect the `<base href>` the backend
 * injects at serve time. Call sites never hardcode a leading slash —
 * every REST and WebSocket endpoint is expressed as a path relative to
 * the document's base URI, which is either `/` (root-mount) or
 * `/some-prefix/` (subpath deploy). See ADR-0018.
 */

const stripLeadingSlash = (p: string): string => (p.startsWith("/") ? p.slice(1) : p);

/**
 * Resolve a backend-relative path against `document.baseURI`. Input is the
 * logical path (`api/config`, `/api/config`, or `./api/config` — all three
 * produce the same result). Output is an absolute URL string suitable for
 * `fetch()`, `<img src>`, etc.
 */
export const apiUrl = (relativePath: string): string => {
  return new URL(stripLeadingSlash(relativePath), document.baseURI).toString();
};

/**
 * Build a WebSocket URL by resolving `relativePath` against `document.baseURI`
 * and swapping the scheme: `https:` → `wss:`, `http:` → `ws:`.
 */
export const wsUrl = (relativePath: string): string => {
  const url = new URL(stripLeadingSlash(relativePath), document.baseURI);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  return url.toString();
};

/**
 * The effective base href, always with a trailing slash. Useful when a
 * caller needs the prefix itself (e.g. for constructing URLs outside this
 * module's helpers) rather than a resolved endpoint URL.
 */
export const baseHref = (): string => {
  const href = document.baseURI;
  return href.endsWith("/") ? href : `${href}/`;
};

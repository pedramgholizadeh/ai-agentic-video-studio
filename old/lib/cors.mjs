/**
 * The bridge between a hosted panel and the engine on this machine.
 *
 * GitHub Pages serves static files only, so the published panel has to talk to
 * a local `server.mjs` over CORS at http://127.0.0.1:<port>. That is an unusual
 * arrangement — a website driving a program on your laptop — so it is opt-in,
 * twice over:
 *
 *   1. the engine only answers cross-origin if it was started with
 *      `--allow-origin <origin>` (or `pages` for any *.github.io site);
 *   2. every mutating request must carry the marker header below, which makes
 *      it a preflighted request. A random webpage cannot send one without CORS,
 *      so it cannot queue jobs on a loopback engine it happens to find.
 *
 * Requests the engine can see are only the local panel it served itself, curl
 * and the CLI — all unaffected by either rule.
 */
export const MARKER = 'x-video-studio';
export const MARKER_VALUE = '1';

/** `--allow-origin https://foo.github.io, https://bar.github.io` or `pages`. */
export function parseAllowed(spec) {
  if (!spec) return null;
  const list = String(spec)
    .split(',')
    .map((s) => s.trim().replace(/\/+$/, ''))
    .filter(Boolean);
  if (!list.length) return null;
  return list;
}

export function allowsOrigin(origin, allowed) {
  if (!origin || !allowed) return false;
  const o = origin.replace(/\/+$/, '');
  for (const rule of allowed) {
    if (rule === 'pages') {
      if (/^https:\/\/[a-z0-9][a-z0-9._-]*\.github\.io$/i.test(o)) return true;
      if (/^https:\/\/[a-z0-9][a-z0-9._-]*\.github\.com$/i.test(o)) return true;
      continue;
    }
    if (rule === '*' || rule.toLowerCase() === 'any') return true;
    if (o.toLowerCase() === rule.toLowerCase()) return true;
  }
  return false;
}

/** Headers to bolt onto a response, or null when this origin is not allowed. */
export function corsHeaders(origin, allowed) {
  if (!allowsOrigin(origin, allowed)) return null;
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': `${MARKER}, content-type`,
    'Access-Control-Max-Age': '600',
    Vary: 'Origin',
  };
}

/**
 * True when an Origin header is this engine's own panel. A browser sends Origin
 * on same-origin *writes* too, so without this the local app would be locked
 * out of its own API by the rules meant for strangers. Loopback aliases count
 * as one machine (127.0.0.1 = localhost = [::1]) as long as the port matches;
 * anything else must match exactly.
 */
const LOOPBACK = new Set(['127.0.0.1', 'localhost', '::1']);

function endpoint(host, port, protocol) {
  return {
    host: String(host || '').toLowerCase().replace(/^\[|\]$/g, ''),
    port: String(port || (protocol === 'https:' ? 443 : 80)),
  };
}

export function isSelf(originHeader, hostHeader) {
  if (!originHeader || !hostHeader) return false;
  let o;
  try {
    o = new URL(originHeader);
  } catch {
    return false;
  }
  const m = /^\[?([^\]]+)\]?:(\d+)$|^([a-z0-9._-]+)$/i.exec(String(hostHeader).toLowerCase());
  if (!m) return false;
  const host = m[1] || m[3];
  const port = m[2];
  const a = endpoint(o.hostname, o.port, o.protocol);
  const b = endpoint(host, port, 'http:');
  if (a.port !== b.port) return false;
  if (LOOPBACK.has(a.host) && LOOPBACK.has(b.host)) return true;
  return a.host === b.host;
}

/**
 * True when the request is allowed to change state: same-origin (no Origin
 * header) or a marked cross-origin call. Browsers put a *lower-cased* header
 * name in req.headers; a hand-written client can use either.
 */
export function isMutating(req) {
  return req.method !== 'GET' && req.method !== 'HEAD' && req.method !== 'OPTIONS';
}

export function hasMarker(req) {
  return req.headers[MARKER] === MARKER_VALUE;
}

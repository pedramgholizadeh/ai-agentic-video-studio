# Security policy

## Scope

This is a **local** application. The engine binds to `127.0.0.1` only and is
meant to be used by the person sitting at that machine. There is no
authentication, because there is no exposed surface: a second user on your
laptop is out of threat model, the public internet is not.

## The hosted-panel bridge (the only remote-facing path)

The panel published on GitHub Pages talks to your local engine from a browser.
Two independent gates protect that path, both in `lib/cors.mjs`:

1. **Opt-in origins.** The engine answers no website at all until it is
   started with `--allow-origin` (e.g. `npm start -- --allow-origin pages`).
   Without the flag every cross-origin request gets
   `403 origin not allowed`. `pages` matches `https://<name>.github.io`
   origins; you can pass one exact origin instead.
2. **Marker header for writes.** Every state-changing cross-origin request
   must carry `x-video-studio: 1`, which forces a CORS preflight. A random
   webpage cannot pass that preflight, so drive-by POSTs from other tabs fail
   with `403 cross-origin writes need the x-video-studio: 1 header`.

Same-origin requests from the panel served by the engine itself
(`http://127.0.0.1:8790`) are exempt from both — a browser sends `Origin` on
same-origin writes, and policing it would lock the panel out of its own API.

## File serving

Job artifact routes confine to their directory: `lib/http.mjs`'s `sendFile`
resolves the requested path and answers `403` when it escapes the `root`
argument, and names coming from the URL go through `safeName` (basename only,
character-allowlisted, length-capped). Job ids come from the job store, not
from the filesystem, and an unknown id is a `404` before any file is touched.

## What is deliberately NOT protected

- The engine trusts the local user completely: `/api/config` writes the local
  settings file, `/api/jobs` reads the paths you give it. That is the product.
- No TLS: the bind is loopback, so plaintext never leaves the machine. If you
  put a tunnel in front of the engine, you have changed the threat model and
  you own it — do not expose `8790` to a network and hand out the URL.
- The `--allow-origin pages` value matches *any* `github.io` subdomain, not
  only this project's. That is fine while the engine only ever answers
  loopback requests from the page you chose to trust.

## Reporting

Open a private security advisory via GitHub (Security → Report a
vulnerability) rather than a public issue. The realistic bug classes are CORS
gaps and path escapes in the file routes; both have focused tests worth
extending.

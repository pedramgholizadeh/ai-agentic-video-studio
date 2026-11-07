/* engine.js — which machine actually builds the video.
 *
 * Started with `npm start` the panel and the engine share one origin and this
 * file does nothing at all. Published on GitHub Pages the panel is a static
 * copy in someone's browser, while the only computer that can render their
 * video is the one under their desk — so every request is re-pointed at
 * http://127.0.0.1:<port> there.
 *
 * Two rules make that safe, both enforced by the engine (lib/cors.mjs):
 *
 *   1. it ignores any origin until started with `--allow-origin`, and
 *   2. anything that changes state must carry the marker header below, which
 *      forces a preflight a random webpage cannot pass.
 *
 * So a hosted panel that finds no engine says so plainly instead of pretending
 * to work, and an engine that finds an unknown website answers 403.
 */
(() => {
  const PORT_KEY = 'studio.engine.port';
  const MARKER = 'x-video-studio';
  const DEFAULT_PORT = 8790;
  const LOOPBACK = /^(127\.0\.0\.1|localhost|\[::1\])$/;

  /** True when this copy of the panel came from a website, not from the engine. */
  const hosted = !LOOPBACK.test(location.hostname) && location.protocol !== 'file:';

  let port = Number(localStorage.getItem(PORT_KEY)) || DEFAULT_PORT;

  const origin = () => `http://127.0.0.1:${port}`;

  /** Same-origin paths stay as they were; hosted calls go to the local engine. */
  const url = (p) => (hosted ? origin() + p : p);

  /** The marker only matters cross-origin, and only for writes. */
  const headers = (method = 'GET') => {
    const m = String(method).toUpperCase();
    return hosted && m !== 'GET' && m !== 'HEAD' && m !== 'OPTIONS' ? { [MARKER]: '1' } : {};
  };

  /** Is an engine listening and does it know this site? A GET is enough. */
  async function probe() {
    try {
      const res = await fetch(url('/api/config'), { headers: headers(), cache: 'no-store' });
      return res.status === 200;
    } catch {
      return false;
    }
  }

  /* ------------------------------------------------------------- the banner */

  const box = document.getElementById('engineOff');
  const portField = document.getElementById('enginePort');
  const state = document.getElementById('engineState');

  function setState(text, kind) {
    if (!state) return;
    state.textContent = text;
    state.className = kind;
  }

  function show() {
    if (!hosted || !box) return;
    box.hidden = false;
    portField.value = port;
    document.getElementById('wizard').hidden = true;
    const machine = document.getElementById('machine');
    if (machine) machine.textContent = '';
    setState('موتور پاسخ نداد.', 'bad');
  }

  function hide() {
    if (box) box.hidden = true;
  }

  if (hosted && box) {
    document.getElementById('engineRetry').onclick = async () => {
      const n = Number(portField.value);
      if (Number.isInteger(n) && n > 0 && n < 65536 && n !== port) {
        port = n;
        localStorage.setItem(PORT_KEY, String(n));
      }
      setState('در حال امتحان…', 'muted');
      if (await probe()) {
        hide();
        window.dispatchEvent(new Event('studio:engine-up'));
      } else {
        setState('هنوز چیزی روی این پورت گوش نمی‌دهد.', 'bad');
      }
    };
    box.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && e.target === portField) document.getElementById('engineRetry').click();
    });
  }

  window.ENGINE = { hosted, port: () => port, origin, url, headers, probe, show, hide };
})();

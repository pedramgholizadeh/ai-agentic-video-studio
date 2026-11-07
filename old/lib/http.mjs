import fs from 'node:fs';
import path from 'node:path';

export function json(res, code, data) {
  const body = JSON.stringify(data);
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

export function text(res, code, body, type = 'text/plain; charset=utf-8') {
  res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store' });
  res.end(body);
}

export async function readBody(req, limit = 2 * 1024 * 1024) {
  const chunks = [];
  let size = 0;
  for await (const c of req) {
    size += c.length;
    if (size > limit) throw new Error('بدنهٔ درخواست بیش از حد بزرگ است');
    chunks.push(c);
  }
  if (!chunks.length) return null;
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    return null;
  }
}

/** Stream a request body straight to disk — a 4 GB source must not hit RAM. */
export function pipeToFile(req, dest, { limitGb = 20 } = {}) {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  return new Promise((resolve, reject) => {
    const out = fs.createWriteStream(dest);
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > limitGb * 1024 * 1024 * 1024) {
        reject(new Error('فایل بیش از حد بزرگ است'));
        req.destroy();
        out.destroy();
      }
    });
    req.pipe(out);
    out.on('finish', () => resolve({ bytes: size, path: dest }));
    out.on('error', reject);
  });
}

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.woff2': 'font/woff2',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mov': 'video/quicktime',
  '.txt': 'text/plain; charset=utf-8',
  '.srt': 'application/x-subrip; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
};

export function contentType(file) {
  return TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream';
}

/**
 * Serve a file with byte ranges so the <video> element can seek, and refuse
 * anything that resolves outside `root`.
 */
export function sendFile(req, res, file, { download = null, root = null } = {}) {
  if (root) {
    const r = path.resolve(root);
    const f = path.resolve(file);
    if (f !== r && !f.startsWith(r + path.sep)) return text(res, 403, 'خارج از محدوده');
  }
  let stat;
  try {
    stat = fs.statSync(file);
  } catch {
    return text(res, 404, 'یافت نشد');
  }
  const range = /bytes=(\d*)-(\d*)/.exec(req.headers.range || '');
  const headers = {
    'Content-Type': contentType(file),
    'Accept-Ranges': 'bytes',
    'Cache-Control': 'no-store',
  };
  if (download) headers['Content-Disposition'] = `attachment; filename="${download.replace(/[^\w.-]/g, '_')}"`;

  if (range) {
    const start = range[1] ? Number(range[1]) : 0;
    const end = range[2] ? Number(range[2]) : stat.size - 1;
    if (Number.isFinite(start) && Number.isFinite(end) && start < stat.size && end >= start) {
      const len = Math.min(end, stat.size - 1) - start + 1;
      res.writeHead(206, { ...headers, 'Content-Range': `bytes ${start}-${start + len - 1}/${stat.size}`, 'Content-Length': len });
      return fs.createReadStream(file, { start, end: start + len - 1 }).pipe(res);
    }
  }
  res.writeHead(200, { ...headers, 'Content-Length': stat.size });
  return fs.createReadStream(file).pipe(res);
}

/** Server-sent events with a keepalive, so a stalled proxy cannot drop the log. */
export function sse(res) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.write(': ok\n\n');
  const ping = setInterval(() => res.write(': ping\n\n'), 20000);
  res.on('close', () => clearInterval(ping));
  return {
    send(event, data) {
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    },
  };
}

export function safeName(name, fallback = 'file') {
  const base = path.basename(String(name || ''))
    .replace(/[\/\\]/g, '')
    .replace(/[^\p{L}\p{N}._-]/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 120);
  return base || fallback;
}

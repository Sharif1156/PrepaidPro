import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { gzipSync } from 'node:zlib';
import { config, publicConfig } from './src/config.js';
import { createCache } from './src/cache.js';
import { AppError, badRequest, notFound, rateLimited } from './src/errors.js';
import { fetchDesco } from './src/desco.js';
import { fetchNesco } from './src/nesco.js';
import { fetchDemo } from './src/demo.js';

const PUBLIC_DIR = resolve(process.cwd(), 'public');
const cache = createCache({ ttlMs: config.cacheTtlMs });
// After the normal TTL a balance is still served instantly for this long while
// a fresh copy loads in the background; the app then refreshes by itself.
const STALE_WINDOW_MS = 60 * 60 * 1000;
const startedAt = Date.now();

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.woff2': 'font/woff2',
};

const SECURITY_HEADERS = {
  'Content-Security-Policy':
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; " +
    "img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; " +
    "manifest-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'self'",
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'X-Frame-Options': 'SAMEORIGIN',
  'Permissions-Policy': 'geolocation=(), microphone=(), camera=(), payment=()',
  'Cross-Origin-Opener-Policy': 'same-origin',
};

/* ------------------------------- rate limit ------------------------------- */

const buckets = new Map();

function rateLimit(key) {
  const now = Date.now();
  const windowMs = 60_000;
  const bucket = buckets.get(key) || { count: 0, resetAt: now + windowMs };
  if (bucket.resetAt <= now) {
    bucket.count = 0;
    bucket.resetAt = now + windowMs;
  }
  bucket.count += 1;
  buckets.set(key, bucket);
  if (buckets.size > 10_000) buckets.clear();
  const retryAfter = Math.ceil((bucket.resetAt - now) / 1000);
  return { allowed: bucket.count <= config.rateLimitPerMinute, retryAfter };
}

/* --------------------------------- helpers -------------------------------- */

function sendJson(res, status, payload, extraHeaders = {}) {
  const body = JSON.stringify(payload);
  const headers = {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    ...SECURITY_HEADERS,
    ...extraHeaders,
  };
  res.writeHead(status, headers);
  res.end(body);
}

function clientIp(req) {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.length) return forwarded.split(',')[0].trim();
  return req.socket.remoteAddress || 'unknown';
}

async function loadCachedMeter(provider, accountNo, refresh) {
  const key = `meter:${provider}:${accountNo}`;
  if (refresh) cache.clear(key);

  const result = await cache.wrap(key, async () => {
    if (config.demoMode) return fetchDemo(provider, accountNo);
    return provider === 'desco' ? fetchDesco(accountNo) : fetchNesco(accountNo);
  }, config.cacheTtlMs, { staleMs: config.demoMode ? 0 : STALE_WINDOW_MS });

  return {
    ...result.value,
    meta: {
      ...(result.value.meta || {}),
      cached: result.cached,
      stale: Boolean(result.stale),
      cacheTtlSeconds: Math.round(config.cacheTtlMs / 1000),
    },
  };
}

function normalizeProvider(value) {
  const provider = String(value || '').toLowerCase();
  if (!['desco', 'nesco'].includes(provider)) {
    throw badRequest("Provider must be either 'desco' or 'nesco'.");
  }
  return provider;
}

/* ---------------------------------- routes -------------------------------- */

async function handleApi(req, res, url) {
  const limit = rateLimit(clientIp(req));
  if (!limit.allowed) throw rateLimited(limit.retryAfter);

  const segments = url.pathname.split('/').filter(Boolean); // ['api', ...]

  if (url.pathname === '/api/health') {
    sendJson(res, 200, {
      ok: true,
      app: config.appName,
      version: config.version,
      demoMode: config.demoMode,
      uptimeSeconds: Math.round((Date.now() - startedAt) / 1000),
      cacheEntries: cache.size(),
      time: new Date().toISOString(),
    });
    return true;
  }

  if (url.pathname === '/api/config') {
    sendJson(res, 200, { ok: true, config: publicConfig() });
    return true;
  }

  if (segments[1] === 'demo' && segments.length >= 4) {
    const provider = normalizeProvider(segments[2]);
    const accountNo = decodeURIComponent(segments[3]).replace(/\D/g, '').slice(0, 16) || '000000';
    const account = {
      ...fetchDemo(provider, accountNo),
      meta: { ...(fetchDemo(provider, accountNo).meta || {}), cached: false, cacheTtlSeconds: 0 },
    };
    sendJson(res, 200, { ok: true, account });
    return true;
  }

  if (segments[1] === 'meter' && segments.length >= 4) {
    const provider = normalizeProvider(segments[2]);
    const accountNo = decodeURIComponent(segments[3]).replace(/\D/g, '');
    if (accountNo.length < 5 || accountNo.length > 16) {
      throw badRequest('The account or meter number must contain 5 to 16 digits.');
    }
    const refresh = ['1', 'true', 'yes'].includes(String(url.searchParams.get('refresh')).toLowerCase());
    const account = await loadCachedMeter(provider, accountNo, refresh);

    if (url.searchParams.get('download') === '1') {
      sendJson(
        res,
        200,
        { ok: true, exportedAt: new Date().toISOString(), account },
        {
          'Content-Disposition': `attachment; filename="prepaidpro-${provider}-${accountNo}.json"`,
        },
      );
      return true;
    }

    sendJson(res, 200, { ok: true, account });
    return true;
  }

  return false;
}

/* ------------------------------ static assets ----------------------------- */

function safePath(pathname) {
  const decoded = decodeURIComponent(pathname.split('?')[0]);
  const relative = normalize(decoded).replace(/^([/\\])+/, '');
  const full = resolve(join(PUBLIC_DIR, relative));
  if (full !== PUBLIC_DIR && !full.startsWith(PUBLIC_DIR + sep)) return null;
  return full;
}

async function serveStatic(req, res, url) {
  let filePath = safePath(url.pathname);
  if (!filePath) {
    res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8', ...SECURITY_HEADERS });
    res.end('Forbidden');
    return;
  }

  let info = await stat(filePath).catch(() => null);
  if (info && info.isDirectory()) info = null;
  if (!info) {
    // Single-page app fallback: extension-less paths render the shell.
    if (!extname(url.pathname)) {
      filePath = join(PUBLIC_DIR, 'index.html');
      info = await stat(filePath).catch(() => null);
    }
    if (!info) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8', ...SECURITY_HEADERS });
      res.end('Not found');
      return;
    }
  }

  const ext = extname(filePath).toLowerCase();
  const etag = `W/"${info.size.toString(16)}-${Math.round(info.mtimeMs).toString(16)}"`;
  const headers = {
    'Content-Type': MIME[ext] || 'application/octet-stream',
    'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=3600',
    ETag: etag,
    ...SECURITY_HEADERS,
  };

  if (req.headers['if-none-match'] === etag) {
    res.writeHead(304, headers);
    res.end();
    return;
  }

  const compressible = /^(text\/|application\/(json|javascript|manifest))/.test(headers['Content-Type']);
  const acceptsGzip = /\bgzip\b/.test(String(req.headers['accept-encoding'] || ''));

  if (compressible && acceptsGzip && info.size > 1024) {
    const buffer = await readFile(filePath);
    const compressed = gzipSync(buffer, { level: 6 });
    headers['Content-Encoding'] = 'gzip';
    headers['Vary'] = 'Accept-Encoding';
    headers['Content-Length'] = compressed.length;
    res.writeHead(200, headers);
    res.end(req.method === 'HEAD' ? undefined : compressed);
    return;
  }

  headers['Content-Length'] = info.size;
  res.writeHead(200, headers);
  if (req.method === 'HEAD') {
    res.end();
    return;
  }
  createReadStream(filePath)
    .on('error', () => res.destroy())
    .pipe(res);
}

/* ---------------------------------- server -------------------------------- */

const server = createServer(async (req, res) => {
  const started = Date.now();
  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);

  res.on('finish', () => {
    if (url.pathname.startsWith('/api/')) {
      const ms = Date.now() - started;
      console.log(`${req.method} ${url.pathname} -> ${res.statusCode} (${ms}ms)`);
    }
  });

  if (!['GET', 'HEAD'].includes(req.method)) {
    sendJson(res, 405, { ok: false, error: { code: 'METHOD_NOT_ALLOWED', message: 'Method not allowed.' } });
    return;
  }

  try {
    if (url.pathname.startsWith('/api/')) {
      const handled = await handleApi(req, res, url);
      if (!handled) {
        throw notFound('Unknown API endpoint.');
      }
      return;
    }
    await serveStatic(req, res, url);
  } catch (error) {
    const isKnown = error instanceof AppError;
    if (!isKnown) console.error('Unhandled error:', error);
    if (res.headersSent) {
      res.destroy();
      return;
    }
    sendJson(res, isKnown ? error.status : 500, {
      ok: false,
      error: isKnown
        ? error.toJSON()
        : { code: 'INTERNAL_ERROR', message: 'Something went wrong on the server.', retryable: true },
    });
  }
});

server.listen(config.port, config.host, () => {
  console.log(`\n  ${config.appName} ${config.version}`);
  console.log(`  Listening on http://${config.host}:${config.port}`);
  console.log(`  Demo mode: ${config.demoMode ? 'ON (generated data)' : 'off (live utility portals)'}`);
  console.log(`  Cache TTL: ${Math.round(config.cacheTtlMs / 1000)}s\n`);
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    console.log(`\n${signal} received, shutting down.`);
    server.close(() => process.exit(0));
  });
}

export { server };

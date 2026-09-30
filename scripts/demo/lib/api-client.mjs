import https from 'node:https';
import http from 'node:http';

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);
const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
// Cookie/header names mirror CSRF_COOKIE_NAME / CSRF_HEADER_NAME in src/api/authPolicy.ts.
const CSRF_COOKIE = 'sanctuary_csrf';
const CSRF_HEADER = 'X-CSRF-Token';

export class ApiError extends Error {
  constructor(method, path, status, body) {
    super(`${method} ${path} -> ${status}: ${typeof body === 'string' ? body : JSON.stringify(body)}`);
    this.name = 'ApiError';
    this.status = status;
    this.body = body;
  }
}

/**
 * Minimal cookie-session client for the Sanctuary browser API.
 * Browser auth is cookie-only (ADR 0001/0002); mutations echo the
 * sanctuary_csrf cookie in X-CSRF-Token, same as tests/install/e2e/auth-flow.test.sh.
 * Self-signed TLS is accepted only for loopback hosts.
 */
export function createApiClient(baseUrl, initialCookies = {}) {
  const origin = new URL(baseUrl);
  const transport = origin.protocol === 'https:' ? https : http;
  const rejectUnauthorized = !LOCAL_HOSTS.has(origin.hostname);
  const cookies = new Map(Object.entries(initialCookies));

  function storeCookies(setCookie = []) {
    for (const header of setCookie) {
      const [pair] = header.split(';');
      const eq = pair.indexOf('=');
      if (eq > 0) cookies.set(pair.slice(0, eq).trim(), pair.slice(eq + 1).trim());
    }
  }

  function buildHeaders(method, payload) {
    const headers = { Accept: 'application/json' };
    if (cookies.size > 0) {
      headers.Cookie = [...cookies].map(([k, v]) => `${k}=${v}`).join('; ');
    }
    if (payload !== undefined) {
      headers['Content-Type'] = 'application/json';
      headers['Content-Length'] = Buffer.byteLength(payload);
    }
    if (MUTATING_METHODS.has(method) && cookies.has(CSRF_COOKIE)) {
      headers[CSRF_HEADER] = cookies.get(CSRF_COOKIE);
    }
    return headers;
  }

  function parseBody(text) {
    if (!text) return null;
    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  }

  function request(method, path, body) {
    const payload = body === undefined ? undefined : JSON.stringify(body);
    const url = new URL(`/api/v1${path}`, origin);
    return new Promise((resolve, reject) => {
      const req = transport.request(url, {
        method,
        headers: buildHeaders(method, payload),
        rejectUnauthorized,
        timeout: 60_000,
      }, (res) => {
        const chunks = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => {
          storeCookies(res.headers['set-cookie']);
          const parsed = parseBody(Buffer.concat(chunks).toString('utf8'));
          if (res.statusCode >= 200 && res.statusCode < 300) resolve(parsed);
          else reject(new ApiError(method, path, res.statusCode, parsed));
        });
      });
      req.on('timeout', () => req.destroy(new Error(`${method} ${path} timed out`)));
      req.on('error', reject);
      if (payload !== undefined) req.write(payload);
      req.end();
    });
  }

  return {
    origin: origin.origin,
    get: (path) => request('GET', path),
    post: (path, body = {}) => request('POST', path, body),
    put: (path, body = {}) => request('PUT', path, body),
    patch: (path, body = {}) => request('PATCH', path, body),
    delete: (path) => request('DELETE', path),
    /** Session cookies as a plain object, for persisting between runs. */
    cookies: () => Object.fromEntries(cookies),
  };
}

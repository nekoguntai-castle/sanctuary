
import { existsSync, readFileSync } from 'node:fs';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import path from 'node:path';
import { formatBody, parseJson } from './common.mjs';

export function createProofApi(context) {
  const {
    apiUrl,
    timeoutMs,
    adminUsername,
    adminPassword,
    sslDir,
  } = context;

  function extractAccessTokenFromSetCookie(setCookieHeaders) {
    if (!setCookieHeaders) return null;
    const cookies = Array.isArray(setCookieHeaders) ? setCookieHeaders : [setCookieHeaders];
    for (const cookie of cookies) {
      if (typeof cookie !== 'string') continue;
      if (!cookie.startsWith('sanctuary_access=')) continue;
      const firstAttr = cookie.split(';')[0];
      const value = firstAttr.slice('sanctuary_access='.length);
      if (value) return value;
    }
    return null;
  }
  
  async function loginForProof() {
    const timed = await timedPublicApiJson(`${apiUrl}/api/v1/auth/login`, {
      method: 'POST',
      body: {
        username: adminUsername,
        password: adminPassword,
      },
    });
    const response = timed.body;
  
    if (response && typeof response === 'object' && response.requires2FA) {
      throw new Error('benchmark user requires 2FA; provide a non-2FA local proof user');
    }
  
    const token = extractAccessTokenFromSetCookie(timed.setCookie);
    if (!token) {
      throw new Error('login response did not include an access token in Set-Cookie');
    }
  
    return token;
  }
  
  async function publicApiJson(url, options = {}, expectedStatuses = [200]) {
    return (await timedPublicApiJson(url, options, expectedStatuses)).body;
  }
  
  async function timedPublicApiJson(url, options = {}, expectedStatuses = [200]) {
    const headers = { Accept: 'application/json' };
    let body;
    if (options.body !== undefined) {
      body = JSON.stringify(options.body);
      headers['Content-Type'] = 'application/json';
    }
    if (options.token) {
      headers.Authorization = `Bearer ${options.token}`;
    }
  
    const startedAt = Date.now();
    const response = await requestText(url, {
      method: options.method || 'GET',
      headers,
      body,
    });
    const parsed = parseJson(response.body);
  
    if (!expectedStatuses.includes(response.status)) {
      throw new Error(`${options.method || 'GET'} ${url} returned ${response.status}: ${formatBody(parsed)}`);
    }
  
    return {
      status: response.status,
      body: parsed,
      setCookie: response.headers['set-cookie'] || null,
      durationMs: Date.now() - startedAt,
    };
  }

  function requestText(url, options) {
    const parsed = new URL(url);
    const client = parsed.protocol === 'https:' ? httpsRequest : httpRequest;
    const requestOptions = {
      method: options.method,
      headers: options.headers,
      timeout: timeoutMs,
      ...(parsed.protocol === 'https:' ? { ca: readComposeCaCertificate() } : {}),
    };

    return new Promise((resolve, reject) => {
      const req = client(parsed, requestOptions, (response) => {
        let responseBody = '';
        response.setEncoding('utf8');
        response.on('data', (chunk) => {
          responseBody += chunk;
        });
        response.on('end', () => {
          resolve({
            status: response.statusCode || 0,
            headers: response.headers,
            body: responseBody,
          });
        });
      });

      req.on('error', reject);
      req.on('timeout', () => {
        req.destroy(new Error('HTTP request timeout'));
      });
      if (options.body) {
        req.write(options.body);
      }
      req.end();
    });
  }

  function readComposeCaCertificate() {
    const caPath = path.join(sslDir, 'fullchain.pem');
    return existsSync(caPath) ? readFileSync(caPath) : undefined;
  }

  return {
    loginForProof,
    publicApiJson,
    timedPublicApiJson,
  };
}

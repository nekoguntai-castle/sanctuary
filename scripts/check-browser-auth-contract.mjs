#!/usr/bin/env node
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

const root = process.env.QUALITY_ROOT ?? process.cwd();
const errors = [];

const browserRoots = [
  'App.tsx',
  'components',
  'contexts',
  'hooks',
  'services',
  'src',
  'themes',
  'utils',
];

const codeFilePattern = /\.(?:ts|tsx|js|jsx)$/;
const excludedPathSegments = [
  '/__tests__/',
  '/fixtures/',
  '/node_modules/',
  '/dist/',
  '/build/',
  '/coverage/',
];

function read(relativePath) {
  return readFileSync(path.join(root, relativePath), 'utf8');
}

function stripComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

function assert(condition, message) {
  if (!condition) {
    errors.push(message);
  }
}

function countMatches(source, pattern) {
  return Array.from(source.matchAll(pattern)).length;
}

function walk(relativePath, files = []) {
  const fullPath = path.join(root, relativePath);
  if (!existsSync(fullPath)) {
    return files;
  }

  const stats = statSync(fullPath);
  const normalized = relativePath.split(path.sep).join('/');

  if (excludedPathSegments.some((segment) => normalized.includes(segment))) {
    return files;
  }

  if (stats.isFile()) {
    if (
      codeFilePattern.test(normalized) &&
      !normalized.includes('.test.') &&
      !normalized.includes('.spec.')
    ) {
      files.push(normalized);
    }
    return files;
  }

  if (!stats.isDirectory()) {
    return files;
  }

  for (const entry of readdirSync(fullPath)) {
    walk(path.join(relativePath, entry), files);
  }

  return files;
}

function listFiles(paths) {
  return paths.flatMap((relativePath) => walk(relativePath));
}

const authPolicy = read('src/api/authPolicy.ts');
const authPolicyExec = stripComments(authPolicy);

assert(authPolicyExec.includes("CSRF_COOKIE_NAME = 'sanctuary_csrf'"), 'authPolicy must own the sanctuary_csrf cookie name');
assert(authPolicyExec.includes("CSRF_HEADER_NAME = 'X-CSRF-Token'"), 'authPolicy must own the X-CSRF-Token header name');
assert(
  authPolicyExec.includes("ACCESS_EXPIRES_AT_HEADER = 'X-Access-Expires-At'"),
  'authPolicy must own the X-Access-Expires-At header name'
);

for (const endpoint of ['/auth/login', '/auth/register', '/auth/2fa/verify', '/auth/refresh']) {
  assert(
    authPolicyExec.includes(`'${endpoint}'`) || authPolicyExec.includes(`"${endpoint}"`),
    `authPolicy refresh-on-401 exemptions must include ${endpoint}`
  );
}

for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
  assert(
    authPolicyExec.includes(`'${method}'`) || authPolicyExec.includes(`"${method}"`),
    `authPolicy must classify ${method} as state-changing for CSRF`
  );
}

const client = read('src/api/client.ts');
const clientExec = stripComments(client);
const clientFetchCount = countMatches(clientExec, /\bfetch\s*\(/g);
const clientCredentialsCount = countMatches(clientExec, /credentials:\s*['"]include['"]/g);

for (const symbol of [
  'ACCESS_EXPIRES_AT_HEADER',
  'attachCsrfHeader',
  'shouldAttemptRefreshAfterUnauthorized',
  'refreshAccessToken',
  'scheduleRefreshFromHeader',
]) {
  assert(clientExec.includes(symbol), `client.ts must use ${symbol}`);
}

assert(clientFetchCount > 0, 'client.ts must contain raw fetch calls owned by the API client');
assert(
  clientCredentialsCount >= clientFetchCount,
  `client.ts fetch calls must all include browser cookies (${clientCredentialsCount}/${clientFetchCount})`
);
assert(!/\b(?:localStorage|sessionStorage)\b/.test(clientExec), 'client.ts must not use browser token storage');
assert(!/\bAuthorization\b/.test(clientExec), 'client.ts must not set Authorization headers for browser auth');
assert(!/\bBearer\b/.test(clientExec), 'client.ts must not build Bearer tokens for browser auth');

const refresh = read('src/api/refresh.ts');
const refreshExec = stripComments(refresh);
assert(!/from\s+['"]\.\/client(?:\.ts)?['"]/.test(refreshExec), 'refresh.ts must not import ./client');
assert(refreshExec.includes('attachCsrfHeader'), 'refresh.ts must attach CSRF on /auth/refresh');
assert(refreshExec.includes('/auth/refresh'), 'refresh.ts must call /auth/refresh directly');
assert(/method:\s*['"]POST['"]/.test(refreshExec), 'refresh.ts /auth/refresh call must use POST');
assert(/credentials:\s*['"]include['"]/.test(refreshExec), 'refresh.ts /auth/refresh call must include cookies');
assert(refreshExec.includes('BroadcastChannel'), 'refresh.ts must broadcast refresh/logout state across tabs');
assert(refreshExec.includes('navigator.locks.request'), 'refresh.ts must serialize refresh with Web Locks');

const backup = read('src/api/admin/backup.ts');
const backupExec = stripComments(backup);
assert(backupExec.includes('attachCsrfHeader'), 'admin backup blob fetch must attach CSRF');
assert(/fetch\s*\([^)]*\/admin\/backup/.test(backupExec), 'admin backup must own the direct blob fetch');
assert(/credentials:\s*['"]include['"]/.test(backupExec), 'admin backup direct fetch must include cookies');

for (const filePath of walk('src/api')) {
  if (filePath === 'src/api/authPolicy.ts') {
    continue;
  }

  const executableSource = stripComments(read(filePath));
  for (const rawContract of ['sanctuary_csrf', 'X-CSRF-Token', 'X-Access-Expires-At']) {
    if (executableSource.includes(rawContract)) {
      errors.push(`${filePath} must import authPolicy instead of spelling ${rawContract}`);
    }
  }
}

const browserFiles = listFiles(browserRoots);
const bannedBrowserTokenPatterns = [
  {
    pattern: /\b(?:localStorage|sessionStorage)\s*\.\s*(?:setItem|getItem|removeItem)\s*\(\s*['"][^'"]*token/i,
    reason: 'must not persist auth tokens in browser storage',
  },
  {
    pattern: /\b(?:localStorage|sessionStorage)\s*\[[^\]]*token/i,
    reason: 'must not persist auth tokens in browser storage',
  },
  {
    pattern: /\bAuthorization\b\s*[:=]/,
    reason: 'must not set Authorization headers for browser backend auth',
  },
  {
    pattern: /\bBearer\s+[`'"]/,
    reason: 'must not build Bearer tokens for browser backend auth',
  },
];

for (const filePath of browserFiles) {
  const executableSource = stripComments(read(filePath));
  for (const { pattern, reason } of bannedBrowserTokenPatterns) {
    if (pattern.test(executableSource)) {
      errors.push(`${filePath} ${reason}`);
    }
  }
}

const gatewayAuth = stripComments(read('gateway/src/middleware/auth.ts'));
assert(
  gatewayAuth.includes('headers.authorization') && gatewayAuth.includes('Bearer'),
  'gateway auth must retain mobile Bearer boundary'
);

const gatewayValidation = stripComments(read('gateway/src/middleware/validateRequest.ts'));
assert(
  gatewayValidation.includes('/api\\/v1\\/auth\\/refresh') || gatewayValidation.includes('/api/v1/auth/refresh'),
  'gateway validation must pin mobile /auth/refresh body contract'
);
assert(gatewayValidation.includes('refreshTokenSchema'), 'gateway validation must use refreshTokenSchema for mobile refresh');

const serverRefresh = stripComments(read('server/src/api/auth/tokens.ts'));
assert(serverRefresh.includes('bodyToken'), 'server refresh endpoint must keep body-token fallback for mobile/gateway');
assert(serverRefresh.includes('cookieToken'), 'server refresh endpoint must keep cookie-token browser path');
assert(serverRefresh.includes('cookieToken && cookieToken.length > 0'), 'server refresh endpoint must prefer cookie token when present');

if (errors.length > 0) {
  console.error('browser-auth-contract: failed');
  for (const error of errors) {
    console.error(`browser-auth-contract: ${error}`);
  }
  process.exit(1);
}

console.log(`browser-auth-contract: passed (${browserFiles.length} browser files scanned)`);

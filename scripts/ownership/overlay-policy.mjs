import path from 'node:path';

export const TRACKED_COMPOSE_FILES = Object.freeze([
  'docker-compose.yml',
  'docker/compose/offline-core.yml',
  'docker/compose/monitoring.yml',
  'docker/compose/offline-monitoring.yml',
  'docker/compose/tor.yml',
  'docker/compose/offline-tor.yml',
]);

const SECRET_KEY = /(?:^|[_-])(?:password|passwd|secret|token|api[_-]?key|private[_-]?key|seed|mnemonic)$/i;
const SENSITIVE_LOCATOR_KEY = /(?:PRIVATE_KEY|SECRET|TOKEN|PASSWORD|SERVICE_ACCOUNT)_(?:PATH|FILE)$/i;
const PEM_PRIVATE_KEY = /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/;
const CREDENTIAL_URL = /\b[a-z][a-z0-9+.-]*:\/\/[^\s/@:]+:[^\s/@]+@/i;

function normalizeRelative(projectDirectory, filePath) {
  const relative = path.relative(projectDirectory, filePath).split(path.sep).join('/');
  if (relative === '' || relative.startsWith('../') || path.isAbsolute(relative)) return null;
  return relative;
}

function scalarValue(line) {
  const match = /^\s*(?:-\s*)?(?:([A-Za-z_][A-Za-z0-9_.-]*)|"([A-Za-z_][A-Za-z0-9_.-]*)"|'([A-Za-z_][A-Za-z0-9_.-]*)')\s*:\s*(.*?)\s*(?:#.*)?$/.exec(line);
  if (!match) return null;
  return { key: match[1] ?? match[2] ?? match[3], value: match[4] };
}

function inlineAssignment(line) {
  const quoted = /^\s*-\s*(["'])([A-Za-z_][A-Za-z0-9_.-]*)=(.*?)\1\s*(?:#.*)?$/.exec(line);
  if (quoted) return { key: quoted[2], value: quoted[3] };
  const plain = /^\s*-\s*([A-Za-z_][A-Za-z0-9_.-]*)=(.*?)\s*(?:#.*)?$/.exec(line);
  return plain ? { key: plain[1], value: plain[2] } : null;
}

function isSafeSecretReference(value) {
  if (value === '') return true;
  const unquoted = value.replace(/^(["'])(.*)\1$/, '$2');
  const match = /^\$\{[A-Z_][A-Z0-9_]*(?:(:\?|\?)([^}]*)|(:-)([^}]*))?\}$/.exec(unquoted);
  if (!match) return false;
  return match[3] !== ':-' || match[4] === '';
}

export function assertSecretFreeOverlay(bytes, { displayPath = 'overlay', custom = false } = {}) {
  if (!Buffer.isBuffer(bytes)) throw new TypeError('overlay bytes must be a Buffer');
  const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  if (text.includes('\0')) throw new Error(`${displayPath} must be UTF-8 text without NUL bytes`);
  if (PEM_PRIVATE_KEY.test(text)) throw new Error(`${displayPath} contains private key material`);

  for (const [index, line] of text.split(/\r?\n/).entries()) {
    const substitutionsRemoved = line.replace(/\$\{[^}]+\}/g, 'ENV');
    const credential = CREDENTIAL_URL.exec(substitutionsRemoved);
    if (credential && !/\b[a-z][a-z0-9+.-]*:\/\/ENV:ENV@/i.test(substitutionsRemoved)) {
      throw new Error(`${displayPath}:${index + 1} contains literal URL credentials`);
    }
    if (custom && /^\s*(?:env_file|secrets|configs)\s*:/.test(line)) {
      throw new Error(`${displayPath}:${index + 1} contains an external secret/config locator`);
    }
    if (custom && /(^|\s)[*!&][A-Za-z0-9_-]+/.test(line)) {
      throw new Error(`${displayPath}:${index + 1} uses unsupported YAML tags, anchors, or aliases`);
    }
    if (custom && /^\s*\?\s/.test(line)) throw new Error(`${displayPath}:${index + 1} uses an unsupported complex mapping key`);
    if (custom && /[\[\]{}]/.test(substitutionsRemoved)) {
      throw new Error(`${displayPath}:${index + 1} uses an unsupported YAML flow collection`);
    }
    const scalar = scalarValue(line);
    const candidate = scalar ?? inlineAssignment(line);
    if (custom && candidate && SENSITIVE_LOCATOR_KEY.test(candidate.key)) {
      throw new Error(`${displayPath}:${index + 1} contains a sensitive file locator`);
    }
    if (custom && /^\s*-\s*[^#]+\.(?:env|key|pem|p8)(?::[^#]*)?\s*$/.test(line)) {
      throw new Error(`${displayPath}:${index + 1} contains a sensitive bind-mounted file`);
    }
    if (!candidate || !SECRET_KEY.test(candidate.key)) continue;
    if (!custom && /(?:_PATH|_FILE)$/.test(candidate.key)) continue;
    if (!isSafeSecretReference(candidate.value)) {
      throw new Error(`${displayPath}:${index + 1} contains a literal secret value`);
    }
  }
}

export function classifyOverlay(projectDirectory, filePath, {
  trackedFiles = TRACKED_COMPOSE_FILES,
  allowCustom = false,
} = {}) {
  const relative = normalizeRelative(projectDirectory, filePath);
  if (relative && trackedFiles.includes(relative)) return { kind: 'tracked', relativePath: relative };
  if (!allowCustom) throw new Error(`custom Compose overlay is not allowed: ${filePath}`);
  return { kind: 'custom', relativePath: null };
}

export function validateOverlay(projectDirectory, filePath, bytes, options = {}) {
  const classification = classifyOverlay(projectDirectory, filePath, options);
  assertSecretFreeOverlay(bytes, { displayPath: filePath, custom: classification.kind === 'custom' });
  return classification;
}

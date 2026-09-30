import { randomBytes } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

export const DEFAULT_ENV_FILE = path.join(repoRoot, 'config/demo/demo.local.env');
export const DEMO_DEFAULTS = Object.freeze({
  username: 'demo',
  url: 'https://localhost:8443',
  project: 'sanctuary',
});

/** Satisfies the server's password strength policy. */
export function generatePassword(bytes = 12) {
  return `Demo-${randomBytes(bytes).toString('hex')}-Aa1!`;
}

/**
 * @param {string} text
 * @returns {Record<string, string>}
 */
export function parseEnvFile(text) {
  /** @type {Record<string, string>} */
  const env = {};
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq <= 0) continue;
    env[line.slice(0, eq).trim()] = line.slice(eq + 1).trim().replace(/^(['"])(.*)\1$/, '$2');
  }
  return env;
}

/**
 * Writes a fresh credentials file with a generated demo password. Fails with
 * EEXIST rather than overwriting one that already exists.
 * @param {string} envFile
 */
export function createEnvFile(envFile) {
  writeFileSync(envFile, [
    '# Local demo-instance credentials (gitignored). See docs/how-to/demo-instance.md.',
    `DEMO_USERNAME=${DEMO_DEFAULTS.username}`,
    `DEMO_PASSWORD=${generatePassword(9)}`,
    `SANCTUARY_DEMO_URL=${DEMO_DEFAULTS.url}`,
    `SANCTUARY_PROJECT=${DEMO_DEFAULTS.project}`,
    '',
  ].join('\n'), { mode: 0o600, flag: 'wx' });
}

/**
 * @param {string} envFile
 * @returns {{ username: string, password: string, url: string, project: string }}
 */
export function readDemoConfig(envFile) {
  const env = parseEnvFile(readFileSync(envFile, 'utf8'));
  if (!env.DEMO_PASSWORD) {
    throw new Error(`DEMO_PASSWORD missing from ${envFile}; run: npm run demo:seed`);
  }
  return {
    username: env.DEMO_USERNAME || DEMO_DEFAULTS.username,
    password: env.DEMO_PASSWORD,
    url: env.SANCTUARY_DEMO_URL || DEMO_DEFAULTS.url,
    project: env.SANCTUARY_PROJECT || DEMO_DEFAULTS.project,
  };
}

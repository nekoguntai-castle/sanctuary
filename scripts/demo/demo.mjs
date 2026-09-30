#!/usr/bin/env node
/**
 * Demo instance tooling: seeds the local Sanctuary stack with public
 * test-vector wallets for screenshots and documentation.
 *
 *   node scripts/demo/demo.mjs seed    # idempotent; creates the demo login on first run
 *   node scripts/demo/demo.mjs status
 *   node scripts/demo/demo.mjs reset   # removes seeded data; add --purge to drop the demo login
 *
 * Stack lifecycle stays with ./start.sh. See docs/how-to/demo-instance.md.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isMainModule } from '../lib/is-main-module.mjs';
import { ApiError, createApiClient } from './lib/api-client.mjs';
import { deleteDemoUser, findBackendContainer, upsertDemoUser } from './lib/container.mjs';
import { createEnvFile, DEFAULT_ENV_FILE, readDemoConfig } from './lib/env.mjs';
import { reset, seed, status } from './lib/seed.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const COMMANDS = { seed: [], status: [], reset: ['--purge'] };
const USAGE = 'usage: node scripts/demo/demo.mjs <seed|status|reset [--purge]>\n';

/**
 * Reuses the previous run's session cookies (gitignored, 0600) while they are
 * still valid: the login limiter allows 5 attempts per 15 minutes, successes included.
 */
async function login(config, sessionFile) {
  if (existsSync(sessionFile)) {
    const api = createApiClient(config.url, JSON.parse(readFileSync(sessionFile, 'utf8')));
    try {
      const me = await api.get('/auth/me');
      if (me?.username === config.username) return api;
    } catch (error) {
      if (!(error instanceof ApiError)) throw error;
    }
  }
  const api = createApiClient(config.url);
  await api.post('/auth/login', { username: config.username, password: config.password });
  writeFileSync(sessionFile, JSON.stringify(api.cookies()), { mode: 0o600 });
  return api;
}

async function main(argv) {
  const [command, ...flags] = argv;
  const allowedFlags = COMMANDS[command];
  if (!allowedFlags || flags.some((flag) => !allowedFlags.includes(flag))) {
    process.stderr.write(USAGE);
    return 2;
  }

  const manifest = JSON.parse(readFileSync(path.join(here, 'manifest.json'), 'utf8'));
  const log = (msg) => process.stdout.write(`${msg}\n`);
  const envFile = process.env.DEMO_ENV_FILE || DEFAULT_ENV_FILE;

  if (command === 'seed' && !existsSync(envFile)) {
    createEnvFile(envFile);
    log(`created ${path.relative(process.cwd(), envFile)} with a generated demo password`);
  }
  const config = readDemoConfig(envFile);
  const sessionFile = path.join(path.dirname(envFile), 'demo.cli-session.local.json');

  if (command === 'seed') {
    upsertDemoUser(findBackendContainer(config.project), {
      username: config.username,
      password: config.password,
      preferences: manifest.demoUser.preferences,
    });
    log(`demo login ready: ${config.username} @ ${config.url}`);
    await seed(await login(config, sessionFile), manifest, log);
    log('seed complete');
  } else if (command === 'status') {
    await status(await login(config, sessionFile), log);
  } else {
    await reset(await login(config, sessionFile), manifest, log);
    if (flags.includes('--purge')) {
      deleteDemoUser(findBackendContainer(config.project), config.username);
      log(`deleted demo login ${config.username}`);
    }
  }
  return 0;
}

if (isMainModule(import.meta.url)) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (error) => {
      process.stderr.write(`demo: ${error.message}\n`);
      process.exit(1);
    },
  );
}

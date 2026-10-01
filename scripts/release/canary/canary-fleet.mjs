#!/usr/bin/env node
/**
 * Release-candidate canary fleet: seeds the release host's local stack with the
 * watch-only test-vector wallets in fleet-manifest.json, so a canary never
 * depends on private or production wallets.
 *
 *   node scripts/release/canary/canary-fleet.mjs seed    # idempotent; waits for each sync
 *   node scripts/release/canary/canary-fleet.mjs status
 *   node scripts/release/canary/canary-fleet.mjs reset   # removes only the fleet wallets
 *
 * Wallets belong to the demo login (scripts/demo). Devices are shared with the
 * demo wallets by fingerprint, so reset leaves them; demo reset removes them.
 * See docs/how-to/release-candidate-canary.md.
 */
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isMainModule } from '../../lib/is-main-module.mjs';
import { findBackendContainer, upsertDemoUser } from '../../demo/lib/container.mjs';
import { createEnvFile, DEFAULT_ENV_FILE, readDemoConfig } from '../../demo/lib/env.mjs';
import { ensureWallets } from '../../demo/lib/seed.mjs';
import { login } from '../../demo/lib/session.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const USAGE = 'usage: node scripts/release/canary/canary-fleet.mjs <seed|status|reset>\n';

function readJson(file) {
  return JSON.parse(readFileSync(file, 'utf8'));
}

/** The canary counts every mainnet wallet on the instance, not only the fleet. */
async function report(api, fleet, log) {
  const names = new Set(fleet.wallets.map((w) => w.name));
  const mainnet = (await api.get('/wallets')).filter((w) => w.network === 'mainnet');
  const seeded = mainnet.filter((w) => names.has(w.name));
  for (const w of seeded) log(`${w.name.padEnd(40)} sync=${w.lastSyncStatus ?? '-'}${w.syncInProgress ? ' (running)' : ''}`);
  log(`${seeded.length}/${fleet.wallets.length} fleet wallets; ${mainnet.length} mainnet wallets visible (canary needs ${fleet.minimumWallets})`);
  return mainnet.length;
}

async function main(argv) {
  const [command, ...rest] = argv;
  if (!['seed', 'status', 'reset'].includes(command) || rest.length) {
    process.stderr.write(USAGE);
    return 2;
  }
  const fleet = readJson(path.join(here, 'fleet-manifest.json'));
  const demo = readJson(path.join(here, '../../demo/manifest.json'));
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
      preferences: demo.demoUser.preferences,
    });
    const api = await login(config, sessionFile);
    await ensureWallets(api, fleet, log);
    return (await report(api, fleet, log)) >= fleet.minimumWallets ? 0 : 1;
  }
  const api = await login(config, sessionFile);
  if (command === 'status') {
    await report(api, fleet, log);
    return 0;
  }
  const names = new Set(fleet.wallets.map((w) => w.name));
  for (const w of (await api.get('/wallets')).filter((w) => w.userRole === 'owner' && names.has(w.name))) {
    await api.delete(`/wallets/${w.id}`);
    log(`deleted wallet ${w.name}`);
  }
  return 0;
}

if (isMainModule(import.meta.url)) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (error) => {
      process.stderr.write(`canary-fleet: ${error.message}\n`);
      process.exit(1);
    },
  );
}

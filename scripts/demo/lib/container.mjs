import { execFileSync } from 'node:child_process';

/**
 * The demo account is created inside the running backend container so the
 * seed never needs the operator's admin password. Pattern borrowed from
 * seed_representative_app_state_fixture in tests/install/e2e/upgrade-install.test.sh.
 * The password travels via an inherited env var (`-e NAME`), never argv.
 *
 * The demo account is marked by DEMO_EMAIL; an existing user without that
 * marker is never overwritten, promoted, or deleted.
 */
export const DEMO_EMAIL = 'demo@demo.invalid';
const PRISMA_PRELUDE = `
const load = (candidates) => {
  for (const c of candidates) { try { return require(c); } catch { /* next */ } }
  throw new Error('Could not load any of: ' + candidates.join(', '));
};
const prismaModule = load(['./dist/app/src/models/prisma.js', './dist/server/src/models/prisma.js', './dist/src/models/prisma.js']);
const prisma = prismaModule.default || prismaModule;
const done = () => prisma.$disconnect();
const fail = (e) => { console.error(e && e.message ? e.message : String(e)); process.exit(1); };
`;

const UPSERT_DEMO_USER = `${PRISMA_PRELUDE}
const bcrypt = load(['bcryptjs', 'bcrypt']);
(async () => {
  const username = process.env.DEMO_USERNAME;
  const marker = process.env.DEMO_EMAIL;
  const existing = await prisma.user.findUnique({ where: { username }, select: { id: true, email: true } });
  if (existing && existing.email !== marker) {
    throw new Error('refusing to take over existing user "' + username + '": it is not a demo account (email is not ' + marker + ')');
  }
  const hash = await bcrypt.hash(process.env.DEMO_PASSWORD, 10);
  const preferences = JSON.parse(process.env.DEMO_PREFERENCES);
  // The marker address is undeliverable (.invalid), so it is marked verified;
  // otherwise instances that require email verification block the demo login.
  const account = { password: hash, isAdmin: true, emailVerified: true, emailVerifiedAt: new Date() };
  const user = existing
    ? await prisma.user.update({ where: { id: existing.id }, data: account, select: { id: true } })
    : await prisma.user.create({ data: { username, email: marker, preferences, ...account }, select: { id: true } });
  process.stdout.write('DEMO_USER_ID=' + user.id + '\\n');
  await done();
})().catch(fail);
`;

const DELETE_DEMO_USER = `${PRISMA_PRELUDE}
(async () => {
  const result = await prisma.user.deleteMany({ where: { username: process.env.DEMO_USERNAME, email: process.env.DEMO_EMAIL } });
  process.stdout.write('DELETED=' + result.count + '\\n');
  await done();
})().catch(fail);
`;

export function findBackendContainer(project) {
  const out = execFileSync('docker', [
    'ps', '-q',
    '--filter', `label=com.docker.compose.project=${project}`,
    '--filter', 'label=com.docker.compose.service=backend',
  ], { encoding: 'utf8' }).trim();
  const ids = out.split('\n').filter(Boolean);
  if (ids.length !== 1) {
    throw new Error(`expected exactly one running backend container for compose project "${project}", found ${ids.length}. Start the stack with ./start.sh first.`);
  }
  return ids[0];
}

function runInBackend(containerId, script, env) {
  const envFlags = Object.keys(env).flatMap((name) => ['-e', name]);
  const stdout = execFileSync('docker', ['exec', '-i', ...envFlags, containerId, 'node', '-'], {
    input: script,
    encoding: 'utf8',
    env: { ...process.env, ...env },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  return stdout;
}

function readMarker(stdout, marker) {
  const line = stdout.split('\n').find((l) => l.startsWith(`${marker}=`));
  if (!line) throw new Error(`backend script did not report ${marker}`);
  return line.slice(marker.length + 1);
}

export function upsertDemoUser(containerId, { username, password, preferences }) {
  const stdout = runInBackend(containerId, UPSERT_DEMO_USER, {
    DEMO_USERNAME: username,
    DEMO_PASSWORD: password,
    DEMO_EMAIL,
    DEMO_PREFERENCES: JSON.stringify(preferences),
  });
  return readMarker(stdout, 'DEMO_USER_ID');
}

export function deleteDemoUser(containerId, username) {
  const stdout = runInBackend(containerId, DELETE_DEMO_USER, { DEMO_USERNAME: username, DEMO_EMAIL });
  return Number(readMarker(stdout, 'DELETED'));
}

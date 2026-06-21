#!/usr/bin/env node
// CI helper for the backend-integration lanes.
//
// The Forgejo `services: postgres` health gate (`pg_isready`) reports ready as
// soon as Postgres accepts connections, which can precede the database being
// usable for `prisma migrate deploy`. The result is a race where migrate exits
// 0 but the schema is absent at test time (`table public.users does not
// exist`). This helper provides two primitives used by
// `scripts/ci/prepare-integration-db.sh` and the integration test step:
//
//   node check-integration-db.mjs wait   [--timeout=90]
//   node check-integration-db.mjs assert [--table=users]
//
// `wait`   blocks until a real `SELECT 1` succeeds (or times out).
// `assert` exits non-zero (with a clear ::error::) if `public.<table>` is
//          missing — i.e. migrations did not land on the database the tests
//          will actually connect to.
//
// The database URL is resolved exactly like the integration tests
// (`server/tests/integration/repositories/setup/database.ts`):
// `TEST_DATABASE_URL || DATABASE_URL`, so the assertion reflects what the
// tests see.

import pgPkg from 'pg';

const { Client } = pgPkg;

function parseArgs(argv) {
  const out = {};
  for (const arg of argv) {
    const match = arg.match(/^--([^=]+)=(.*)$/);
    if (match) {
      out[match[1]] = match[2];
    } else if (arg.startsWith('--')) {
      out[arg.slice(2)] = true;
    }
  }
  return out;
}

function resolveUrl() {
  const url = process.env.TEST_DATABASE_URL || process.env.DATABASE_URL;
  if (!url) {
    console.error(
      '::error::check-integration-db: neither TEST_DATABASE_URL nor DATABASE_URL is set'
    );
    process.exit(2);
  }
  return url;
}

function redact(url) {
  return url.replace(/(\/\/[^:/?#]+:)[^@]*@/, '$1***@');
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function connectClient(url) {
  const client = new Client({ connectionString: url, connectionTimeoutMillis: 5000 });
  await client.connect();
  return client;
}

async function waitReady(url, timeoutSeconds) {
  const deadline = Date.now() + timeoutSeconds * 1000;
  let attempt = 0;
  let lastError = 'unknown error';
  for (;;) {
    attempt += 1;
    let client;
    try {
      client = await connectClient(url);
      await client.query('SELECT 1');
      console.log(
        `check-integration-db: postgres ready after ${attempt} attempt(s) at ${redact(url)}`
      );
      await client.end();
      return;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
      if (client) {
        await client.end().catch(() => {});
      }
      if (Date.now() >= deadline) {
        console.error(
          `::error::check-integration-db: postgres not ready after ${timeoutSeconds}s ` +
            `(${attempt} attempts) at ${redact(url)}: ${lastError}`
        );
        process.exit(1);
      }
      await sleep(1000);
    }
  }
}

async function assertTable(url, table) {
  let client;
  try {
    client = await connectClient(url);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(
      `::error::check-integration-db: cannot connect at ${redact(url)}: ${message}`
    );
    process.exit(1);
  }
  try {
    const { rows } = await client.query('SELECT to_regclass($1) AS reg', [`public.${table}`]);
    const present = rows[0] && rows[0].reg !== null;
    if (present) {
      console.log(`check-integration-db: schema OK — public.${table} exists at ${redact(url)}`);
      return;
    }
    console.error(
      `::error::check-integration-db: public.${table} is MISSING at ${redact(url)} ` +
        '— prisma migrate deploy did not land on this database'
    );
    process.exit(1);
  } finally {
    await client.end().catch(() => {});
  }
}

const args = parseArgs(process.argv.slice(3));
const command = process.argv[2];
const url = resolveUrl();

if (command === 'wait') {
  await waitReady(url, Number(args.timeout ?? 90));
} else if (command === 'assert') {
  await assertTable(url, String(args.table ?? 'users'));
} else {
  console.error('Usage: check-integration-db.mjs <wait|assert> [--timeout=N] [--table=NAME]');
  process.exit(2);
}

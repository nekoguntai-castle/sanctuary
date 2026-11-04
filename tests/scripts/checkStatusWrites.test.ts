import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const scriptPath = join(process.cwd(), 'scripts/check-status-writes.mjs');
const OWNER = 'server/src/repositories/draftRepository.ts';
const roots: string[] = [];

function writeFile(root: string, relativePath: string, source: string) {
  const filePath = join(root, relativePath);
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${source.trim()}\n`);
}

function writeOwners(root: string, owners: Array<{ file: string; reason?: string }>) {
  writeFile(root, 'scripts/quality/status-write-owners.json', JSON.stringify({
    version: 1,
    columns: [{
      model: 'draftTransaction',
      table: 'draft_transactions',
      field: 'status',
      owners: owners.map((owner) => ({ reason: 'fixture owner', ...owner })),
    }],
  }));
}

function createRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'sanctuary-status-writes-'));
  roots.push(root);
  return root;
}

function runCheck(root: string) {
  const result = spawnSync(process.execPath, [scriptPath, '--json'], {
    cwd: process.cwd(),
    env: { ...process.env, QUALITY_ROOT: root },
    encoding: 'utf8',
  });
  return { status: result.status, summary: JSON.parse(result.stdout) };
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('check-status-writes', () => {
  it('passes when the guarded column is written only by its owner', () => {
    const root = createRoot();
    writeOwners(root, [{ file: OWNER }]);
    writeFile(root, OWNER, `
      export const archive = (id: string) =>
        prisma.draftTransaction.updateMany({ where: { id }, data: { status: 'broadcasted' } });
    `);

    const { status, summary } = runCheck(root);

    expect(status).toBe(0);
    expect(summary.writes).toEqual([{ column: 'draftTransaction.status', file: OWNER, line: 2 }]);
  });

  it('fails on a literal write outside the owner modules', () => {
    const root = createRoot();
    writeOwners(root, [{ file: OWNER }]);
    writeFile(root, OWNER, `export const own = () => tx.draftTransaction.update({ where: { id }, data: { status } });`);
    writeFile(root, 'server/src/api/drafts.ts', `
      await prisma.draftTransaction.update({ where: { id }, data: { label: 'x', status: 'signed' } });
    `);

    const { status, summary } = runCheck(root);

    expect(status).toBe(1);
    expect(summary.unownedWrites).toEqual([
      { column: 'draftTransaction.status', file: 'server/src/api/drafts.ts', line: 1 },
    ]);
  });

  it('ignores writes that do not name the guarded column', () => {
    const root = createRoot();
    writeOwners(root, [{ file: OWNER }]);
    writeFile(root, OWNER, `export const own = () => db.draftTransaction.create({ data: input });`);
    writeFile(root, 'server/src/api/drafts.ts', `
      await prisma.draftTransaction.update({ where: { id }, data: { label: 'x' } });
      await prisma.wallet.update({ where: { id }, data: { status: 'x' } });
      await prisma.draftTransaction.findMany({ where: { status: 'signed' } });
    `);

    expect(runCheck(root).status).toBe(0);
  });

  it.each([
    ['an identifier', 'data: input'],
    ['a spread', 'data: { ...patch }'],
    ['a computed key', "data: { [key]: 'signed' }"],
    ['an upsert create', 'create: input, update: {}'],
    ['a createMany array', 'data: [{ label: "a" }, row]'],
  ])('treats %s as writing every guarded column of the model', (_label, args) => {
    const root = createRoot();
    writeOwners(root, [{ file: OWNER }]);
    writeFile(root, OWNER, `export const own = () => db.draftTransaction.create({ data: input });`);
    writeFile(root, 'server/src/services/other.ts', `await prisma.draftTransaction.upsert({ where: { id }, ${args} });`);

    const { status, summary } = runCheck(root);

    expect(status).toBe(1);
    expect(summary.unownedWrites.map((write: { file: string }) => write.file)).toEqual(['server/src/services/other.ts']);
  });

  it('detects raw SQL that updates or inserts the guarded column', () => {
    const root = createRoot();
    writeOwners(root, [{ file: OWNER }]);
    writeFile(root, OWNER, `export const own = () => db.draftTransaction.create({ data: input });`);
    writeFile(root, 'server/src/services/raw.ts', `
      await tx.$executeRaw\`UPDATE "draft_transactions" SET "status" = \${next} WHERE "id" = \${id}\`;
      await tx.$executeRawUnsafe('INSERT INTO draft_transactions ("id", "status") VALUES ($1, $2)', id, s);
      await tx.$queryRaw\`SELECT "status" FROM "draft_transactions"\`;
    `);

    const { summary } = runCheck(root);

    expect(summary.unownedWrites).toEqual([
      { column: 'draftTransaction.status', file: 'server/src/services/raw.ts', line: 1 },
      { column: 'draftTransaction.status', file: 'server/src/services/raw.ts', line: 2 },
    ]);
  });

  it('skips tests and generated code', () => {
    const root = createRoot();
    writeOwners(root, [{ file: OWNER }]);
    writeFile(root, OWNER, `export const own = () => db.draftTransaction.create({ data: input });`);
    const write = `await prisma.draftTransaction.update({ where: { id }, data: { status: 'signed' } });`;
    writeFile(root, 'server/src/api/drafts.test.ts', write);
    writeFile(root, 'server/src/generated/prisma/client.ts', write);

    expect(runCheck(root).status).toBe(0);
  });

  it('fails on a stale owner entry that no longer writes its column', () => {
    const root = createRoot();
    writeOwners(root, [{ file: OWNER }, { file: 'server/src/services/old.ts' }]);
    writeFile(root, OWNER, `export const own = () => db.draftTransaction.create({ data: input });`);

    const { status, summary } = runCheck(root);

    expect(status).toBe(1);
    expect(summary.staleOwners).toEqual([{ column: 'draftTransaction.status', file: 'server/src/services/old.ts' }]);
  });

  it('rejects an owner entry without a reason and an unknown file version', () => {
    const root = createRoot();
    writeFile(root, 'scripts/quality/status-write-owners.json', JSON.stringify({
      version: 2,
      columns: [{ model: 'draftTransaction', table: '', field: 'status', owners: [{ file: OWNER, reason: ' ' }] }],
    }));
    writeFile(root, OWNER, `export const own = () => db.draftTransaction.create({ data: input });`);

    const { status, summary } = runCheck(root);

    expect(status).toBe(1);
    expect(summary.errors).toEqual([
      'owners file version must be 1',
      'columns[0].table must be a non-empty string',
      'columns[0].owners[0].reason must explain the ownership',
    ]);
  });

  it('passes the repository inventory', () => {
    const result = spawnSync(process.execPath, [scriptPath], { cwd: process.cwd(), encoding: 'utf8' });
    expect(result.status, result.stderr).toBe(0);
  });
});

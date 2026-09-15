import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, mkdirSync, symlinkSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { isMainModule } from '../../scripts/lib/is-main-module.mjs';

// `esm-main-guard-silent-noop-under-symlink` (Phase 0, iteration 23): Node
// resolves symlinks (and percent-encodes special characters) when it builds
// the entry module's `import.meta.url`, but `process.argv[1]` is the literal,
// unresolved command-line string. Every guard that compared the two directly
// (``import.meta.url === `file://${process.argv[1]}` `` or
// `pathToFileURL(resolve(process.argv[1])).href === import.meta.url`) was
// therefore false whenever the CLI was invoked through a symlinked directory,
// so the guarded body silently never ran. `isMainModule` fixes this by
// comparing realpath-resolved filesystem paths on both sides.

function withTempDir(run) {
  const dir = mkdtempSync(join(tmpdir(), 'is-main-module-test-'));
  try {
    return run(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('matches when argv[1] is invoked through a symlinked directory', () => {
  withTempDir((dir) => {
    const realDir = join(dir, 'real');
    const scriptPath = join(realDir, 'cli.mjs');
    mkdirSync(realDir);
    writeFileSync(scriptPath, '// fixture\n');

    const symlinkedDir = join(dir, 'linked');
    symlinkSync(realDir, symlinkedDir);
    const symlinkedScriptPath = join(symlinkedDir, 'cli.mjs');

    // Node resolves the symlink when computing the entry module's
    // import.meta.url, so the "real" module URL is what a direct `node
    // <symlinkedScriptPath>` invocation would produce internally.
    const moduleUrl = pathToFileURL(scriptPath).href;

    assert.equal(isMainModule(moduleUrl, symlinkedScriptPath), true);
  });
});

test('matches a path containing a space that pathToFileURL percent-encodes', () => {
  withTempDir((dir) => {
    const realDir = join(dir, 'has space');
    const scriptPath = join(realDir, 'cli.mjs');
    mkdirSync(realDir);
    writeFileSync(scriptPath, '// fixture\n');

    const moduleUrl = pathToFileURL(scriptPath).href;
    assert.match(moduleUrl, /%20/);

    // argv[1] is the literal, unencoded path the shell would pass.
    assert.equal(isMainModule(moduleUrl, scriptPath), true);
  });
});

test('tolerates a missing process.argv[1]', () => {
  const moduleUrl = pathToFileURL('/nonexistent/does-not-matter.mjs').href;
  assert.equal(isMainModule(moduleUrl, undefined), false);
  assert.equal(isMainModule(moduleUrl, ''), false);
});

test('falls back to resolve() for a non-existent argv[1] path and still matches', () => {
  withTempDir((dir) => {
    const scriptPath = join(dir, 'cli.mjs');
    writeFileSync(scriptPath, '// fixture\n');
    const moduleUrl = pathToFileURL(scriptPath).href;

    // A relative, non-existent-on-disk variant of the same path (extra `.`
    // segment) must still resolve to the same target via path.resolve.
    const argv1 = join(dir, '.', 'cli.mjs');
    assert.equal(isMainModule(moduleUrl, argv1), true);
  });
});

test('does not match a different module', () => {
  withTempDir((dir) => {
    const scriptPath = join(dir, 'cli.mjs');
    const otherPath = join(dir, 'other.mjs');
    writeFileSync(scriptPath, '// fixture\n');
    writeFileSync(otherPath, '// fixture\n');

    const moduleUrl = pathToFileURL(scriptPath).href;
    assert.equal(isMainModule(moduleUrl, otherPath), false);
  });
});

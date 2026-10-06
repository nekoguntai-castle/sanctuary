const assert = require('node:assert/strict');
const { test } = require('node:test');

// Exercise the callers of overridden packages, not just their package versions.
test('front matter preserves YAML aliases and merge keys', () => {
  const matter = require('@11ty/gray-matter');
  const result = matter('---\ndefaults: &defaults\n  title: Base\npage:\n  <<: *defaults\n  label: Docs\n---\nBody');
  assert.deepEqual(result.data.page, { title: 'Base', label: 'Docs' });
  const loadYaml = require('node:module').createRequire(require.resolve('@11ty/gray-matter'))('js-yaml').load;
  assert.equal(loadYaml(''), undefined);
});

test('Docusaurus Joi extensions validate and reject front matter', () => {
  const { JoiFrontMatter } = require('@docusaurus/utils-validation');
  const schema = JoiFrontMatter.object({ title: JoiFrontMatter.string().required(), sidebar_position: JoiFrontMatter.number() });
  assert.equal(schema.validate({ title: 'Architecture', sidebar_position: 2 }).error, undefined);
  assert.ok(schema.validate({ sidebar_position: 'not-a-number' }).error);
});

test('SVGR optimization preserves accessible scalable SVG content', () => {
  const optimize = require('@svgr/plugin-svgo');
  const result = optimize('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><title>Diagram</title><path d="M0 0h10v10z"/></svg>', { svgo: true }, { filePath: 'diagram.svg' });
  assert.match(result, /viewBox="0 0 10 10"/);
  assert.match(result, /<title>Diagram<\/title>/);
  assert.match(result, /<path/);
});

test('PostCSS can synchronously load nanoid and assign distinct input identities', () => {
  const postcss = require('postcss');
  const ids = new Set(Array.from({ length: 100 }, () => postcss.parse('a { color: red }').source.input.id));
  assert.equal(ids.size, 100);
  for (const id of ids) assert.match(id, /^<input css .{6}>$/);
});

test('cosmiconfig retains the TypeScript JavaScript API alongside the native compiler', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const directory = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'sanctuary-docs-ts-config-'));
  try {
    const filename = path.join(directory, 'config.ts');
    const source = 'const answer: number = 42; export default { answer };';
    fs.writeFileSync(filename, source);
    const { loadTsSync } = require('cosmiconfig/dist/loaders');
    assert.deepEqual(loadTsSync(filename, source), { answer: 42 });
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('Tinypool keeps the worker contract Docusaurus SSG relies on', async () => {
  // Mirrors @docusaurus/core/lib/ssg/ssgExecutor.js and ssgWorkerThread.js:
  // the options it passes, process.__tinypool_state__.workerId and
  // workerData[1].params inside the worker, run() and destroy().
  const fs = require('node:fs');
  const path = require('node:path');
  const { pathToFileURL } = require('node:url');
  const directory = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'sanctuary-docs-tinypool-'));
  try {
    const worker = path.join(directory, 'worker.cjs');
    fs.writeFileSync(worker, [
      "const { workerData } = require('node:worker_threads');",
      'const workerId = process?.__tinypool_state__?.workerId;',
      "if (!workerId) throw new Error('not in Tinypool context');",
      'const params = workerData?.[1]?.params;',
      "if (!params) throw new Error('workerData params missing');",
      'module.exports = async (task) => ({ id: task.id, workerId, label: params.label, pages: task.pathnames.length });',
    ].join('\n'));
    const Tinypool = (await import('tinypool')).default;
    const pool = new Tinypool({
      filename: pathToFileURL(worker).pathname,
      minThreads: 2,
      maxThreads: 2,
      concurrentTasksPerWorker: 1,
      runtime: 'worker_threads',
      isolateWorkers: false,
      workerData: { params: { label: 'ssg' } },
      maxMemoryLimitBeforeRecycle: 1000000000,
      resourceLimits: {},
    });
    try {
      const results = await Promise.all([1, 2, 3].map((id) => pool.run({ id, pathnames: ['/a', '/b'] })));
      assert.deepEqual(results.map((r) => [r.id, r.label, r.pages]), [[1, 'ssg', 2], [2, 'ssg', 2], [3, 'ssg', 2]]);
      for (const r of results) assert.ok(r.workerId);
    } finally {
      await pool.destroy();
    }
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

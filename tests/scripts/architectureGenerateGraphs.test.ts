import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  assertMermaidGraph,
  expandPackageGlobs,
  wrap,
} from '../../scripts/architecture/generate-graphs.mjs';

async function makePackage(files: string[]) {
  const cwd = await mkdtemp(path.join(tmpdir(), 'sanctuary-graphs-'));
  for (const file of files) {
    const absolutePath = path.join(cwd, file);
    await mkdir(path.dirname(absolutePath), { recursive: true });
    await writeFile(absolutePath, 'export const value = 1;\n', 'utf8');
  }
  return cwd;
}

describe('generate-graphs helpers', () => {
  it('expands configured globs to stable unique POSIX paths', async () => {
    const cwd = await makePackage(['src/index.ts', 'src/helper.ts']);

    await expect(expandPackageGlobs({
      name: 'fixture',
      cwd,
      globs: ['src/**/*.ts', 'src/index.ts'],
    })).resolves.toEqual(['src/helper.ts', 'src/index.ts']);
  });

  it('fails when a configured graph pattern matches no files', async () => {
    const cwd = await makePackage(['src/index.ts']);

    await expect(expandPackageGlobs({
      name: 'fixture',
      cwd,
      globs: ['src/**/*.ts', 'missing/**/*.ts'],
    })).rejects.toThrow('generate-graphs: fixture: no files matched missing/**/*.ts');
  });

  it('fails closed when dependency-cruiser returns blank Mermaid output', () => {
    expect(() => assertMermaidGraph({ name: 'fixture' }, '', 2)).toThrow(
      'generate-graphs: fixture: dependency-cruiser produced no Mermaid graph for 2 inputs',
    );
  });

  it('wraps a generated graph with the architecture appendix guidance', () => {
    const markdown = wrap(
      { name: 'fixture', title: 'Fixture', collapse: '^src/[^/]+/' },
      'flowchart LR\nA-->B',
    );

    expect(markdown).toContain('title: Fixture module graph');
    expect(markdown).toContain('## How to read this graph');
    expect(markdown).toContain('flowchart LR\nA-->B');
  });
});

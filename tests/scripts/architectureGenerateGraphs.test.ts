import { readFileSync } from 'node:fs';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  assertMermaidGraph,
  expandPackageGlobs,
  stabilizeMermaidIds,
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

  it('keeps frontend feature groups visible beneath the canonical src root', () => {
    const graph = readFileSync('docs/architecture/generated/frontend.md', 'utf8');
    expect(graph).toContain('["AILabelSuggestion"]');
    expect(graph).toContain('["WalletDetail"]');
  });
});

describe('stabilizeMermaidIds', () => {
  const graph = (...lines: string[]) => ['flowchart LR', '', ...lines].join('\n');

  it('names each node for its path through the subgraphs', () => {
    const out = stabilizeMermaidIds(graph(
      'subgraph 0["shared"]',
      'subgraph 1["constants"]',
      '2["bitcoin.ts"]',
      'end',
      'end',
    ));

    expect(out).toContain('subgraph n_shared["shared"]');
    expect(out).toContain('subgraph n_shared_constants["constants"]');
    expect(out).toContain('n_shared_constants_bitcoin_ts["bitcoin.ts"]');
  });

  it('rewrites edges to match, so the graph still resolves', () => {
    const out = stabilizeMermaidIds(graph(
      '0["a.ts"]',
      '1["b.ts"]',
      '0-->1',
    ));

    expect(out).toContain('n_a_ts-->n_b_ts');
    expect(out).not.toMatch(/^0-->1$/m);
  });

  it('names a collapsed group\'s hidden files for the group', () => {
    // dependency-cruiser emits them with a blank label; anonymous ids would be
    // positional again.
    const out = stabilizeMermaidIds(graph(
      'subgraph 0["components"]',
      '1[" "]',
      'end',
    ));

    expect(out).toContain('n_components__collapsed[" "]');
  });

  it('keeps ids stable when a node is inserted before others', () => {
    // The whole point: adding a module must not renumber everything after it.
    const before = stabilizeMermaidIds(graph('0["a.ts"]', '1["z.ts"]', '0-->1'));
    const after = stabilizeMermaidIds(graph('0["a.ts"]', '1["m.ts"]', '2["z.ts"]', '0-->2'));

    expect(before).toContain('n_z_ts["z.ts"]');
    expect(after).toContain('n_z_ts["z.ts"]');
    expect(after).toContain('n_a_ts-->n_z_ts');
  });

  it('suffixes rather than merges when two labels slug the same', () => {
    // "a.ts" and "a-ts" both sanitize to n_a_ts; collapsing them would silently
    // fuse two modules into one node.
    const out = stabilizeMermaidIds(graph('0["a.ts"]', '1["a-ts"]'));

    expect(out).toContain('n_a_ts["a.ts"]');
    expect(out).toContain('n_a_ts_2["a-ts"]');
  });

  it('leaves everything that is not a node or an edge untouched', () => {
    const out = stabilizeMermaidIds(graph('%% a comment', 'subgraph 0["x"]', 'end'));

    expect(out.split('\n')[0]).toBe('flowchart LR');
    expect(out).toContain('%% a comment');
  });
});


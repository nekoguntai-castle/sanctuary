import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { glob } from 'node:fs/promises';

/**
 * Guards Tailwind colour utilities against shades the theme does not emit.
 *
 * Tailwind is configured at runtime in `src/index.html`, and every themed
 * palette maps to `var(--color-<palette>-<shade>)`. A utility naming a shade
 * the config does not declare is not a compile error and not a lint error — it
 * simply produces no CSS, so the element silently keeps whatever colour it
 * inherited. That is invisible in review, invisible in jsdom, and invisible in
 * a screenshot unless you happen to know the intended colour.
 *
 * It had accumulated 172 such classes before this test existed: 148 using
 * `success`/`warning`/`sent` shades 300 and 400, which no theme emits (only
 * `midnight` defines 400, so mapping it globally would break the other
 * thirteen), and 24 using the `shared` palette, which every theme emits in full
 * but which the config had simply never mapped.
 */

const REPO_ROOT = join(__dirname, '..', '..');

/** Palettes whose utilities resolve through `var(--color-*)`. */
const THEMED_PALETTES = [
  'primary',
  'success',
  'warning',
  'sent',
  'shared',
  'mainnet',
  'testnet',
  'signet',
  'sanctuary',
] as const;

const COLOR_UTILITIES = [
  'bg',
  'text',
  'border',
  'ring',
  'from',
  'via',
  'to',
  'divide',
  'outline',
  'decoration',
  'fill',
  'stroke',
  'accent',
  'caret',
  'placeholder',
].join('|');

function declaredShades(): Record<string, Set<string>> {
  const config = readFileSync(join(REPO_ROOT, 'src', 'index.html'), 'utf8');
  const declared: Record<string, Set<string>> = {};

  for (const palette of THEMED_PALETTES) {
    const block = new RegExp(`\\b${palette}\\s*:\\s*\\{(.*?)\\n\\s*\\},`, 's').exec(config);
    declared[palette] = new Set(
      block ? Array.from(block[1].matchAll(/(\d+)\s*:/g), (m) => m[1]) : []
    );
  }

  return declared;
}

async function sourceFiles(): Promise<string[]> {
  const files: string[] = [];
  for await (const file of glob('src/**/*.{ts,tsx}', { cwd: REPO_ROOT })) {
    files.push(file as string);
  }
  return files.sort();
}

describe('theme colour class policy', () => {
  it('declares every themed palette the components actually use', () => {
    const declared = declaredShades();

    // `shared` is the one that went missing: components referenced it for
    // months while the config never mapped it.
    for (const palette of THEMED_PALETTES) {
      expect(declared[palette].size, `${palette} missing from the Tailwind config`).toBeGreaterThan(0);
    }
  });

  it('uses no colour utility naming a shade the config does not declare', async () => {
    const declared = declaredShades();
    const pattern = new RegExp(
      `(?<![\\w-])((?:[a-z-]+:)*)(${COLOR_UTILITIES})-(${THEMED_PALETTES.join('|')})-(\\d{2,3})(?![\\w])`,
      'g'
    );

    const offenders: string[] = [];

    for (const file of await sourceFiles()) {
      const lines = readFileSync(join(REPO_ROOT, file), 'utf8').split('\n');
      lines.forEach((line, index) => {
        for (const match of line.matchAll(pattern)) {
          const [full, , , palette, shade] = match;
          if (!declared[palette].has(shade)) {
            offenders.push(`${file}:${index + 1} ${full}`);
          }
        }
      });
    }

    expect(
      offenders,
      `These utilities name shades the theme does not emit, so they produce no CSS:\n${offenders.join('\n')}`
    ).toEqual([]);
  });
});

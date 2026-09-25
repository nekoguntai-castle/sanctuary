import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Every recharts <Tooltip> must say how it renders values.
 *
 * Without a `formatter` (or a custom `content` renderer), recharts prints the
 * data point's raw number. Chart data in this app is in sats, so a bare
 * Tooltip shows an unformatted integer whatever the BTC/sats preference is.
 * The Wallets page balance chart shipped that way until 2026-09. Component
 * tests mock recharts, so they only catch this if they happen to exercise the
 * formatter; this guard catches it for every chart, including new ones.
 */

const SRC_ROOT = path.resolve(__dirname, '../../src');

function listTsxFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return listTsxFiles(full);
    return entry.name.endsWith('.tsx') ? [full] : [];
  });
}

/** Names the recharts Tooltip is imported as in this source, if at all. */
function rechartsTooltipNames(source: string): string[] {
  const names: string[] = [];
  const importPattern = /import\s*\{([^}]*)\}\s*from\s*['"]recharts['"]/g;
  for (const match of source.matchAll(importPattern)) {
    for (const specifier of match[1].split(',')) {
      const [imported, local] = specifier.trim().split(/\s+as\s+/);
      if (imported === 'Tooltip') names.push(local ?? imported);
    }
  }
  return names;
}

/**
 * Returns the opening tag text of each <Name ...> element in the source. Props
 * may contain arrow functions (`=>`) and nested JSX, so the tag ends at the
 * first `>` seen at brace depth zero that is not part of `=>`.
 */
function openingTags(source: string, name: string): string[] {
  const tags: string[] = [];
  const tagStart = new RegExp(`<${name}(?![\\w.])`, 'g');
  for (const match of source.matchAll(tagStart)) {
    let depth = 0;
    let i = match.index + match[0].length;
    for (; i < source.length; i += 1) {
      const ch = source[i];
      if (ch === '{') depth += 1;
      else if (ch === '}') depth -= 1;
      else if (ch === '>' && depth === 0 && source[i - 1] !== '=') break;
    }
    tags.push(source.slice(match.index, i + 1));
  }
  return tags;
}

function unformattedTooltips(source: string): string[] {
  return rechartsTooltipNames(source).flatMap((name) =>
    openingTags(source, name).filter((tag) => !/\b(formatter|content)=/.test(tag)),
  );
}

describe('recharts Tooltip value formatting', () => {
  it('flags a Tooltip that formats only its label', () => {
    const source = `
      import { Tooltip } from 'recharts';
      const a = <Tooltip labelFormatter={(t) => String(t)} contentStyle={{ border: 'none' }} />;
      const b = <Tooltip formatter={(value) => [format(value as number), 'Balance']} />;
      const c = <Tooltip content={<ChartTooltip format={format} />} />;
    `;
    const flagged = unformattedTooltips(source);
    expect(flagged).toHaveLength(1);
    expect(flagged[0]).toContain('labelFormatter');
  });

  it('follows an aliased import and ignores non-recharts Tooltips', () => {
    const aliased = `import { Tooltip as ChartTip } from 'recharts';\nconst x = <ChartTip cursor={false} />;`;
    const other = `import { Tooltip } from '../ui/Tooltip';\nconst x = <Tooltip label="Syncing" />;`;
    expect(unformattedTooltips(aliased)).toHaveLength(1);
    expect(unformattedTooltips(other)).toHaveLength(0);
  });

  it('every recharts Tooltip in src declares a value formatter or custom content', () => {
    const offenders = listTsxFiles(SRC_ROOT).flatMap((file) =>
      unformattedTooltips(readFileSync(file, 'utf8')).map(
        (tag) => `${path.relative(SRC_ROOT, file)}: ${tag.replace(/\s+/g, ' ')}`,
      ),
    );
    expect(offenders).toEqual([]);
  });
});

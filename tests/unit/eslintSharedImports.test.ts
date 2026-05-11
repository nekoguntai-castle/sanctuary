// Phase F1c: lightweight config-import smoke that asserts the
// no-restricted-imports patterns for shared/ DON'T contain the
// over-matching `**/shared/**` pattern (which would also match the
// new workspace specifier `@sanctuary/shared/...` and block every
// migrated import).
//
// This is a config-shape unit test, NOT a programmatic ESLint run —
// avoids the ~3-5s plugin loading cost and the API-version fragility.

import { describe, expect, it } from 'vitest';

// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore — eslint.config.js is plain JS without types
import config from '../../eslint.config.js';

describe('Phase F1c: ESLint shared/ import patterns', () => {
  it('production source block does not over-match the workspace specifier', () => {
    const productionBlock = (config as Array<Record<string, unknown>>).find((block) => {
      const files = block.files;
      return Array.isArray(files) && files.includes('server/src/**/*.ts');
    });
    expect(productionBlock).toBeDefined();
    const rules = (productionBlock as { rules: Record<string, unknown> }).rules;
    const restrictedImports = rules['no-restricted-imports'] as
      | undefined
      | [string, { patterns: Array<{ group: string[] }> }];
    expect(restrictedImports).toBeDefined();
    const allPatterns = restrictedImports![1].patterns.flatMap((p) => p.group);
    expect(allPatterns).not.toContain('**/shared/**');
    expect(allPatterns).not.toContain('@sanctuary/shared/**');
    // Sanity: at least one relative-path pattern must be present
    expect(allPatterns.some((p) => p.endsWith('/shared/**') && p.startsWith('..'))).toBe(true);
  });

  it('ai-proxy block bans BOTH the workspace specifier and relative-path shared imports', () => {
    const aiProxyBlock = (config as Array<Record<string, unknown>>).find((block) => {
      const files = block.files;
      return Array.isArray(files) && files[0] === 'ai-proxy/**/*.ts';
    });
    expect(aiProxyBlock).toBeDefined();
    const rules = (aiProxyBlock as { rules: Record<string, unknown> }).rules;
    const restrictedImports = rules['no-restricted-imports'] as
      | undefined
      | [string, { patterns: Array<{ group: string[] }> }];
    expect(restrictedImports).toBeDefined();
    const allPatterns = restrictedImports![1].patterns.flatMap((p) => p.group);
    expect(allPatterns).toContain('@sanctuary/shared/**');
    expect(allPatterns.some((p) => p.endsWith('/shared/**') && p.startsWith('..'))).toBe(true);
  });
});

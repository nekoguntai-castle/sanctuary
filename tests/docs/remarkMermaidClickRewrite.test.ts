import { describe, expect, it } from 'vitest';
import remarkMermaidClickRewrite from '../../website/src/plugins/remark-mermaid-click-rewrite.mjs';

function rewriteMermaid(value: string) {
  const codeNode = { type: 'code', lang: 'mermaid', value };
  const tree = { type: 'root', children: [codeNode] };
  const transform = remarkMermaidClickRewrite({
    repoUrl: 'https://github.com/acme/sanctuary',
    branch: 'main',
    repoRoot: '/repo',
    siteBaseUrl: '/sanctuary/',
    internalDocRoutes: {
      'docs/architecture/containers.md': 'docs/architecture/containers',
    },
  });

  transform(tree, { path: '/repo/docs/architecture/README.md' });
  return codeNode.value;
}

describe('remarkMermaidClickRewrite', () => {
  it('keeps curated doc clicks inside the Docusaurus site and preserves hashes', () => {
    const rewritten = rewriteMermaid('click API href "./containers.md#gateway" "Open diagram"');

    expect(rewritten).toBe('click API href "/sanctuary/docs/architecture/containers#gateway" "Open diagram"');
  });

  it('rewrites source clicks to GitHub blob URLs with hashes preserved', () => {
    const rewritten = rewriteMermaid('click Source href "../../server/src/api/notifications.ts#L12" "View source"');

    expect(rewritten).toBe(
      'click Source href "https://github.com/acme/sanctuary/blob/main/server/src/api/notifications.ts#L12" "View source"',
    );
  });

  it('leaves external, root-relative, anchor, and repo-escaping clicks unchanged', () => {
    const input = [
      'click External href "https://example.com" "External"',
      'click Root href "/docs/architecture" "Root"',
      'click Anchor href "#local" "Anchor"',
      'click Escape href "../../../outside.md" "Escape"',
    ].join('\n');

    expect(rewriteMermaid(input)).toBe(input);
  });
});

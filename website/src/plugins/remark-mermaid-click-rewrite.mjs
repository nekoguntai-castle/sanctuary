/**
 * Remark plugin: rewrite Mermaid `click NodeId href "<relative-path>"` directives
 * to absolute GitHub URLs at Docusaurus build time.
 *
 * The C4 markdown is authored with hrefs relative to the source `.md` location
 * so they navigate correctly when GitHub renders the file natively. Inside
 * Docusaurus the rendered URL is detached from the source path, so the same
 * relative href would 404. This plugin rewrites them at build to
 * `<repoUrl>/blob/<branch>/<resolved-path>` so they work in both renderings.
 *
 * External hrefs (http, https, mailto, anchor, root-absolute) pass through.
 *
 * Plugin options: { repoUrl: string, branch?: string, repoRoot?: string }
 */

import path from 'node:path';

const CLICK_LINE = /^(\s*click\s+\S+\s+href\s+")([^"]+)("[^\n]*)$/gm;

function isExternal(href) {
  return /^(https?:|mailto:|#|\/)/i.test(href);
}

export default function remarkMermaidClickRewrite(options = {}) {
  const repoUrl = options.repoUrl;
  const branch = options.branch ?? 'main';
  // The plugin is invoked with cwd = website/ during build; repo root is the parent.
  const repoRoot = options.repoRoot ?? path.resolve(process.cwd(), '..');
  if (!repoUrl) throw new Error('remark-mermaid-click-rewrite: repoUrl is required');

  return (tree, file) => {
    const sourcePath = file.path ?? file.history?.[file.history.length - 1];
    if (!sourcePath) return;
    const sourceDir = path.dirname(sourcePath);

    visit(tree, (node) => {
      if (node.type !== 'code' || node.lang !== 'mermaid' || typeof node.value !== 'string') return;
      node.value = node.value.replace(CLICK_LINE, (match, prefix, href, suffix) => {
        if (isExternal(href)) return match;
        const absolutePath = path.resolve(sourceDir, href);
        const relativeFromRepo = path.relative(repoRoot, absolutePath).split(path.sep).join('/');
        if (relativeFromRepo.startsWith('..')) return match;
        return `${prefix}${repoUrl}/blob/${branch}/${relativeFromRepo}${suffix}`;
      });
    });
  };
}

function visit(tree, fn) {
  fn(tree);
  for (const child of tree.children ?? []) visit(child, fn);
}

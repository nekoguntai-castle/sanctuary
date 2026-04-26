/**
 * Remark plugin: rewrite Mermaid `click NodeId href "<relative-path>"` directives
 * at Docusaurus build time.
 *
 * The C4 markdown is authored with hrefs relative to the source `.md` location
 * so they navigate correctly when GitHub renders the file natively. Inside
 * Docusaurus the rendered URL is detached from the source path. This plugin
 * keeps curated doc targets inside the Docusaurus site and rewrites source-code
 * or off-contract repository targets to GitHub blob URLs.
 *
 * External hrefs (http, https, mailto, anchor, root-absolute) pass through.
 *
 * Plugin options:
 * { repoUrl: string, branch?: string, repoRoot?: string, siteBaseUrl?: string, internalDocRoutes?: Record<string, string> }
 */

import path from 'node:path';

const CLICK_LINE = /^(\s*click\s+\S+\s+href\s+")([^"]+)("[^\n]*)$/gm;

function isExternal(href) {
  return /^(https?:|mailto:|#|\/)/i.test(href);
}

function splitHash(href) {
  const hashIndex = href.indexOf('#');
  if (hashIndex === -1) return { pathname: href, hash: '' };
  return {
    pathname: href.slice(0, hashIndex),
    hash: href.slice(hashIndex),
  };
}

function toRepoRelativePath(repoRoot, absolutePath) {
  const relativeFromRepo = path.relative(repoRoot, absolutePath).split(path.sep).join('/');
  if (relativeFromRepo === '..' || relativeFromRepo.startsWith('../')) return null;
  return relativeFromRepo;
}

function joinSitePath(siteBaseUrl, routePath) {
  const base = siteBaseUrl.endsWith('/') ? siteBaseUrl : `${siteBaseUrl}/`;
  return `${base}${routePath.replace(/^\/+/, '')}`;
}

export default function remarkMermaidClickRewrite(options = {}) {
  const repoUrl = options.repoUrl;
  const branch = options.branch ?? 'main';
  const siteBaseUrl = options.siteBaseUrl ?? '/';
  const internalDocRoutes = options.internalDocRoutes ?? {};
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
        const { pathname, hash } = splitHash(href);
        const absolutePath = path.resolve(sourceDir, pathname);
        const relativeFromRepo = toRepoRelativePath(repoRoot, absolutePath);
        if (!relativeFromRepo) return match;
        const internalRoute = internalDocRoutes[relativeFromRepo];
        if (internalRoute) {
          return `${prefix}${joinSitePath(siteBaseUrl, internalRoute)}${hash}${suffix}`;
        }
        return `${prefix}${repoUrl}/blob/${branch}/${relativeFromRepo}${hash}${suffix}`;
      });
    });
  };
}

function visit(tree, fn) {
  fn(tree);
  for (const child of tree.children ?? []) visit(child, fn);
}

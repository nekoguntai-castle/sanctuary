#!/usr/bin/env node

import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const [sourceRoot, actionKind] = process.argv.slice(2);

if (!sourceRoot || !['upload', 'download'].includes(actionKind)) {
  throw new Error('usage: patch-dependencies.mjs <source-root> <upload|download>');
}

const expectedArtifactVersions = {
  upload: '2.1.1',
  download: '2.1.4',
};
const expectedNodeFetchVersions = {
  upload: '2.7.0',
  download: '2.6.12',
};
const expectedPunycodeVersions = {
  upload: '2.1.1',
  download: '2.3.1',
};
const expectedNccVersions = {
  upload: '0.36.0',
  download: '0.33.4',
};

function readJson(relativePath) {
  return JSON.parse(readFileSync(path.join(sourceRoot, relativePath), 'utf8'));
}

function assertLockedVersion(lock, packageName, expectedVersion) {
  const packageEntry = lock.packages[`node_modules/${packageName}`];
  if (packageEntry?.version !== expectedVersion) {
    throw new Error(
      `${actionKind}: expected ${packageName}@${expectedVersion}, found ${packageEntry?.version ?? 'missing'}`,
    );
  }
}

function replaceExact(relativePath, oldSource, newSource, expectedCount = 1) {
  const filePath = path.join(sourceRoot, relativePath);
  const source = readFileSync(filePath, 'utf8');
  const actualCount = source.split(oldSource).length - 1;
  if (actualCount !== expectedCount) {
    throw new Error(
      `${actionKind}: ${relativePath}: expected ${expectedCount} occurrence(s), found ${actualCount}`,
    );
  }
  writeFileSync(filePath, source.replaceAll(oldSource, newSource));
}

const lock = readJson('package-lock.json');
assertLockedVersion(lock, '@actions/artifact', expectedArtifactVersions[actionKind]);
assertLockedVersion(lock, '@azure/storage-blob', '12.17.0');
assertLockedVersion(lock, 'node-fetch', expectedNodeFetchVersions[actionKind]);
assertLockedVersion(lock, 'unzip-stream', '0.3.1');
assertLockedVersion(lock, 'binary', '0.3.0');
assertLockedVersion(lock, 'buffers', '0.1.1');
assertLockedVersion(lock, 'punycode', expectedPunycodeVersions[actionKind]);
assertLockedVersion(lock, '@vercel/ncc', expectedNccVersions[actionKind]);

// ncc treats the bare `punycode` specifier as Node's deprecated builtin. The
// trailing slash resolves the already-locked userland punycode package instead,
// allowing ncc to include it in the standalone action bundle.
replaceExact(
  'node_modules/tr46/index.js',
  'var punycode = require("punycode");',
  'var punycode = require("punycode/");',
);
replaceExact(
  'node_modules/whatwg-url/lib/url-state-machine.js',
  'const punycode = require("punycode");',
  'const punycode = require("punycode/");',
);

// The signed Forgejo compatibility commits patch the checked-in bundles so
// @actions/artifact uses the Forgejo-provided results service on a non-GitHub
// server. Reapply that exact compatibility boundary to the locked dependency
// source before rebuilding; otherwise a fresh ncc bundle rejects Forgejo as
// unsupported GHES before it reaches the proven v4 protocol.
replaceExact(
  'node_modules/@actions/artifact/lib/internal/shared/config.js',
  `function isGhes() {
    const ghUrl = new URL(process.env['GITHUB_SERVER_URL'] || 'https://github.com');
    const hostname = ghUrl.hostname.trimEnd().toUpperCase();
    const isGitHubHost = hostname === 'GITHUB.COM';
    const isGheHost = hostname.endsWith('.GHE.COM') || hostname.endsWith('.GHE.LOCALHOST');
    return !isGitHubHost && !isGheHost;
}`,
  `function isGhes() {
    return false;
}`,
);

if (actionKind === 'upload') {
  assertLockedVersion(lock, '@actions/glob', '0.3.0');
  // Backport the include-hidden-files behavior from upload-artifact v4.4.0.
  // Forgejo's protocol fork predates @actions/glob's excludeHiddenFiles option,
  // so add the same traversal guard to its exact locked glob@0.3.0 rather than
  // changing any protocol dependency or replacing the lockfile.
  replaceExact(
    'node_modules/@actions/glob/lib/internal-glob-options.d.ts',
    `    omitBrokenSymbolicLinks?: boolean;
}`,
    `    omitBrokenSymbolicLinks?: boolean;
    /**
     * Indicates whether hidden files and directories should be excluded.
     *
     * @default false
     */
    excludeHiddenFiles?: boolean;
}`,
  );
  replaceExact(
    'node_modules/@actions/glob/lib/internal-glob-options-helper.js',
    `        matchDirectories: true,
        omitBrokenSymbolicLinks: true
    };`,
    `        matchDirectories: true,
        omitBrokenSymbolicLinks: true,
        excludeHiddenFiles: false
    };`,
  );
  replaceExact(
    'node_modules/@actions/glob/lib/internal-glob-options-helper.js',
    `        if (typeof copy.omitBrokenSymbolicLinks === 'boolean') {
            result.omitBrokenSymbolicLinks = copy.omitBrokenSymbolicLinks;
            core.debug(\`omitBrokenSymbolicLinks '\${result.omitBrokenSymbolicLinks}'\`);
        }
    }`,
    `        if (typeof copy.omitBrokenSymbolicLinks === 'boolean') {
            result.omitBrokenSymbolicLinks = copy.omitBrokenSymbolicLinks;
            core.debug(\`omitBrokenSymbolicLinks '\${result.omitBrokenSymbolicLinks}'\`);
        }
        if (typeof copy.excludeHiddenFiles === 'boolean') {
            result.excludeHiddenFiles = copy.excludeHiddenFiles;
            core.debug(\`excludeHiddenFiles '\${result.excludeHiddenFiles}'\`);
        }
    }`,
  );
  replaceExact(
    'node_modules/@actions/glob/lib/internal-globber.js',
    `                if (!stats) {
                    continue;
                }
                // Directory`,
    `                if (!stats) {
                    continue;
                }
                // Hidden file or directory?
                if (options.excludeHiddenFiles && path.basename(item.path).match(/^\\./)) {
                    continue;
                }
                // Directory`,
  );

  replaceExact(
    'src/shared/search.ts',
    `function getDefaultGlobOptions(): glob.GlobOptions {
  return {
    followSymbolicLinks: true,
    implicitDescendants: true,
    omitBrokenSymbolicLinks: true
  }
}`,
    `function getDefaultGlobOptions(
  includeHiddenFiles: boolean
): glob.GlobOptions {
  return {
    followSymbolicLinks: true,
    implicitDescendants: true,
    omitBrokenSymbolicLinks: true,
    excludeHiddenFiles: !includeHiddenFiles
  }
}`,
  );
  replaceExact(
    'src/shared/search.ts',
    `export async function findFilesToUpload(
  searchPath: string,
  globOptions?: glob.GlobOptions
): Promise<SearchResult> {
  const searchResults: string[] = []
  const globber = await glob.create(
    searchPath,
    globOptions || getDefaultGlobOptions()
  )`,
    `export async function findFilesToUpload(
  searchPath: string,
  includeHiddenFiles?: boolean
): Promise<SearchResult> {
  const searchResults: string[] = []
  const globber = await glob.create(
    searchPath,
    getDefaultGlobOptions(includeHiddenFiles || false)
  )`,
  );
  replaceExact(
    'src/upload/constants.ts',
    `  CompressionLevel = 'compression-level',
  Overwrite = 'overwrite'`,
    `  CompressionLevel = 'compression-level',
  Overwrite = 'overwrite',
  IncludeHiddenFiles = 'include-hidden-files'`,
  );
  replaceExact(
    'src/upload/input-helper.ts',
    `  const overwrite = core.getBooleanInput(Inputs.Overwrite)

  const ifNoFilesFound`,
    `  const overwrite = core.getBooleanInput(Inputs.Overwrite)
  const includeHiddenFiles = core.getBooleanInput(Inputs.IncludeHiddenFiles)

  const ifNoFilesFound`,
  );
  replaceExact(
    'src/upload/input-helper.ts',
    `    ifNoFilesFound: noFileBehavior,
    overwrite: overwrite`,
    `    ifNoFilesFound: noFileBehavior,
    overwrite: overwrite,
    includeHiddenFiles: includeHiddenFiles`,
  );
  replaceExact(
    'src/upload/upload-inputs.ts',
    `  overwrite: boolean
}`,
    `  overwrite: boolean

  /**
   * Whether or not to include hidden files in the artifact
   */
  includeHiddenFiles: boolean
}`,
  );
  replaceExact(
    'src/upload/upload-artifact.ts',
    `  const searchResult = await findFilesToUpload(inputs.searchPath)`,
    `  const searchResult = await findFilesToUpload(
    inputs.searchPath,
    inputs.includeHiddenFiles
  )`,
  );
  replaceExact(
    'action.yml',
    `    default: 'false'

outputs:`,
    `    default: 'false'
  include-hidden-files:
    description: >
      If true, hidden files will be included in the artifact.
      If false, hidden files will be excluded from the artifact.
    default: 'false'

outputs:`,
  );
  replaceExact(
    'action.yml',
    'Anonymous downloads will be prompted to first login. \n',
    'Anonymous downloads will be prompted to first login.\n',
  );
  replaceExact(
    'action.yml',
    'https://docs.github.com/en/rest/actions/artifacts#download-an-artifact    \n',
    'https://docs.github.com/en/rest/actions/artifacts#download-an-artifact\n',
  );
}

// node-fetch 2 normalizes an absolute URL with WHATWG URL, then immediately
// converts it back through deprecated url.parse(). Keep the legacy object shape
// expected by node-fetch 2 while deriving every field from WHATWG URL. This is
// deliberately not a copied legacy parser and rejects relative request URLs.
replaceExact(
  'node_modules/node-fetch/lib/index.js',
  `// fix an issue where "format", "parse" aren't a named export for node <10
const parse_url = Url.parse;
const format_url = Url.format;`,
  `const format_url = Url.format;`,
);

replaceExact(
  'node_modules/node-fetch/lib/index.js',
  `function parseURL(urlStr) {
\t/*
 \tCheck whether the URL is absolute or not
 \t\tScheme: https://tools.ietf.org/html/rfc3986#section-3.1
 \tAbsolute URL: https://tools.ietf.org/html/rfc3986#section-4.3
 */
\tif (/^[a-zA-Z][a-zA-Z\\d+\\-.]*:/.exec(urlStr)) {
\t\turlStr = new URL(urlStr).toString();
\t}

\t// Fallback to old implementation for arbitrary URLs
\treturn parse_url(urlStr);
}`,
  `function parseURL(urlStr) {
\tconst parsedURL = new URL(urlStr);
\tconst username = decodeURIComponent(parsedURL.username);
\tconst password = decodeURIComponent(parsedURL.password);
\tconst auth = username || password ? username + ':' + password : null;
\tconst hostname = parsedURL.hostname.startsWith('[') && parsedURL.hostname.endsWith(']')
\t\t? parsedURL.hostname.slice(1, -1)
\t\t: parsedURL.hostname;
\tconst search = parsedURL.search || null;

\treturn {
\t\tprotocol: parsedURL.protocol,
\t\tslashes: true,
\t\tauth,
\t\thost: parsedURL.host,
\t\tport: parsedURL.port || null,
\t\thostname,
\t\thash: parsedURL.hash || null,
\t\tsearch,
\t\tquery: search === null ? null : search.slice(1),
\t\tpathname: parsedURL.pathname,
\t\tpath: parsedURL.pathname + (search || ''),
\t\thref: parsedURL.href
\t};
}`,
);

const replacements = [
  ['node_modules/unzip-stream/lib/matcher-stream.js', "new Buffer('')", 'Buffer.alloc(0)', 2],
  ['node_modules/unzip-stream/lib/unzip-stream.js', "new Buffer('')", 'Buffer.alloc(0)', 3],
  ['node_modules/unzip-stream/lib/unzip-stream.js', 'new Buffer(4)', 'Buffer.alloc(4)', 1],
  ['node_modules/binary/index.js', 'new Buffer(search)', 'Buffer.from(search)', 2],
  ['node_modules/buffers/index.js', 'new Buffer(start)', 'Buffer.alloc(start)', 1],
  [
    'node_modules/buffers/index.js',
    'new Buffer(orig.length - start - howMany)',
    'Buffer.alloc(orig.length - start - howMany)',
    1,
  ],
  ['node_modules/buffers/index.js', 'new Buffer(j - i)', 'Buffer.alloc(j - i)', 1],
  ['node_modules/buffers/index.js', 'new Buffer(needle)', 'Buffer.from(needle)', 1],
  [
    'node_modules/tunnel/lib/tunnel.js',
    'new Buffer(connectOptions.proxyAuth)',
    'Buffer.from(connectOptions.proxyAuth)',
    1,
  ],
  ['node_modules/whatwg-url/lib/url-state-machine.js', 'new Buffer(c)', 'Buffer.from(c)', 1],
  ['node_modules/whatwg-url/lib/url-state-machine.js', 'new Buffer(str)', 'Buffer.from(str)', 1],
  ['node_modules/whatwg-url/lib/url-state-machine.js', 'new Buffer(output)', 'Buffer.from(output)', 1],
  [
    'node_modules/whatwg-url/lib/url-state-machine.js',
    'new Buffer(this.buffer)',
    'Buffer.from(this.buffer)',
    1,
  ],
];

for (const replacement of replacements) {
  replaceExact(...replacement);
}

replaceExact('action.yml', "using: 'node20'", "using: 'node24'");

console.log(`${actionKind}: exact Forgejo v4 dependencies patched for Node 24`);

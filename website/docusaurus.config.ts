import type { Config } from '@docusaurus/types';
import type * as Preset from '@docusaurus/preset-classic';
import { themes as prismThemes } from 'prism-react-renderer';
import remarkMermaidClickRewrite from './src/plugins/remark-mermaid-click-rewrite.mjs';

const REPO_OWNER = 'nekoguntai-castle';
const REPO_NAME = 'sanctuary';
const REPO_URL = `https://github.com/${REPO_OWNER}/${REPO_NAME}`;

const config: Config = {
  title: 'Sanctuary',
  tagline: 'Self-hosted Bitcoin wallet — living architecture & docs',
  favicon: 'img/favicon.ico',

  url: `https://${REPO_OWNER}.github.io`,
  baseUrl: `/${REPO_NAME}/`,
  organizationName: REPO_OWNER,
  projectName: REPO_NAME,
  trailingSlash: false,

  onBrokenLinks: 'warn',

  markdown: {
    mermaid: true,
    // Existing prose uses CommonMark autolinks like `<https://example.com>`
    // which MDX would parse as JSX. `detect` keeps `.md` as plain CommonMark
    // and reserves MDX for `.mdx`.
    format: 'detect',
    hooks: {
      // Existing prose docs reference assets via paths relative to the repo
      // root (e.g. `../assets/foo.png`); they render fine on GitHub but
      // Docusaurus can't resolve them. Warn instead of failing the build.
      onBrokenMarkdownLinks: 'warn',
      onBrokenMarkdownImages: 'warn',
    },
  },
  themes: ['@docusaurus/theme-mermaid'],

  presets: [
    [
      'classic',
      {
        docs: {
          // Source markdown from the repo, not from website/docs.
          path: '..',
          routeBasePath: '/',
          sidebarPath: './sidebars.ts',
          include: [
            'docs/architecture/**/*.md',
            'docs/explanation/**/*.md',
            'docs/how-to/**/*.md',
            'docs/reference/**/*.md',
            'docs/adr/**/*.md',
            'docs/PRD.md',
            'docs/README.md',
            'server/ARCHITECTURE.md',
            'gateway/ARCHITECTURE.md',
            'CONTRIBUTING.md',
          ],
          exclude: ['**/node_modules/**', '**/_*.md'],
          editUrl: ({ docPath }) => `${REPO_URL}/edit/main/${docPath}`,
          beforeDefaultRemarkPlugins: [
            [remarkMermaidClickRewrite, { repoUrl: REPO_URL, branch: 'main' }],
          ],
        },
        blog: false,
        theme: {
          customCss: './src/css/custom.css',
        },
      } satisfies Preset.Options,
    ],
  ],

  clientModules: [require.resolve('./src/clientModules/mermaidPanZoom.ts')],

  themeConfig: {
    colorMode: { defaultMode: 'light', respectPrefersColorScheme: true },
    navbar: {
      title: 'Sanctuary',
      items: [
        { to: '/docs/architecture/', label: 'Architecture', position: 'left' },
        { to: '/CONTRIBUTING', label: 'Contributing', position: 'left' },
        { href: REPO_URL, label: 'GitHub', position: 'right' },
      ],
    },
    footer: {
      style: 'light',
      links: [
        {
          title: 'Project',
          items: [
            { label: 'GitHub', href: REPO_URL },
            { label: 'Issues', href: `${REPO_URL}/issues` },
          ],
        },
      ],
      copyright: `Built with Docusaurus · ${new Date().getFullYear()} Sanctuary`,
    },
    prism: {
      theme: prismThemes.github,
      darkTheme: prismThemes.dracula,
    },
    mermaid: {
      // Required for `click NodeId href "..."` directives to navigate.
      options: { securityLevel: 'loose' },
    },
  } satisfies Preset.ThemeConfig,
};

export default config;

import reactHooks from 'eslint-plugin-react-hooks';
import tseslint from 'typescript-eslint';

const productionSource = [
  'App.tsx',
  'components/**/*.{ts,tsx}',
  'contexts/**/*.{ts,tsx}',
  'hooks/**/*.{ts,tsx}',
  'services/**/*.{ts,tsx}',
  'src/**/*.{ts,tsx}',
  'themes/**/*.{ts,tsx}',
  'utils/**/*.{ts,tsx}',
  'shared/**/*.ts',
  'server/src/**/*.ts',
  'gateway/src/**/*.ts',
];

export default [
  {
    linterOptions: {
      reportUnusedDisableDirectives: 'off',
    },
  },
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/build/**',
      '**/coverage/**',
      '**/reports/**',
      '**/playwright-report/**',
      '**/test-results/**',
      'server/src/generated/**',
      'scripts/verify-addresses/output/**',
    ],
  },
  {
    files: productionSource,
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: {
        ecmaFeatures: {
          jsx: true,
        },
        ecmaVersion: 'latest',
        sourceType: 'module',
      },
    },
    plugins: {
      '@typescript-eslint': tseslint.plugin,
      'react-hooks': reactHooks,
    },
    rules: {
      '@typescript-eslint/ban-ts-comment': ['error', {
        'ts-check': false,
        'ts-expect-error': 'allow-with-description',
        'ts-ignore': true,
        'ts-nocheck': true,
        minimumDescriptionLength: 3,
      }],
      // Phase F1: relative-path shared/ imports are forbidden in production
      // source. Use the workspace package: from '@sanctuary/shared/...'.
      // Patterns scope only relative paths so the new workspace specifier
      // remains allowed (depth-7 covers the deepest test paths in the repo).
      'no-restricted-imports': ['error', {
        patterns: [
          {
            group: [
              '../shared/**',
              '../../shared/**',
              '../../../shared/**',
              '../../../../shared/**',
              '../../../../../shared/**',
              '../../../../../../shared/**',
              '../../../../../../../shared/**',
            ],
            message: "Import shared via the workspace package: from '@sanctuary/shared/...'.",
          },
        ],
      }],
      'no-restricted-syntax': ['error',
        {
          selector: "CallExpression[callee.object.name='console'][callee.property.name='log']",
          message: 'Use createLogger() instead of console.log in production source.',
        },
        {
          selector: "CatchClause > Identifier[typeAnnotation.typeAnnotation.type='TSAnyKeyword']",
          message: 'Use catch (error) and getErrorMessage() instead of catch (error: any).',
        },
        {
          selector: 'CatchClause > BlockStatement[body.length=0]',
          message: 'Empty catch blocks hide failures; log or handle the error.',
        },
        {
          selector:
            'FunctionDeclaration[id.name=/^(getErrorMessage|extractErrorMessage)$/], ' +
            'VariableDeclarator[id.name=/^(getErrorMessage|extractErrorMessage)$/][init.type=/^(ArrowFunctionExpression|FunctionExpression)$/]',
          message: 'Import getErrorMessage/extractErrorMessage from shared/utils/errors instead of redefining locally.',
        },
      ],
    },
  },
  {
    files: [
      'server/src/utils/logger.ts',
      'gateway/src/utils/logger.ts',
    ],
    rules: {
      'no-restricted-syntax': 'off',
    },
  },
  {
    // shared/utils/errors.ts is the canonical home for these helpers, so the
    // rule that bans local redefinitions must not fire on the source of truth.
    // llm-egress-proxy is intentionally network-isolated and re-implements equivalents
    // in llm-egress-proxy/src/utils.ts; importing from shared into llm-egress-proxy would
    // break that boundary.
    files: [
      'shared/utils/errors.ts',
      'llm-egress-proxy/src/utils.ts',
    ],
    rules: {
      'no-restricted-syntax': 'off',
    },
  },
  {
    // shared/ source files import from each other via relative paths inside
    // the package (e.g. shared/utils/bitcoin.ts -> ../constants/bitcoin).
    // These intra-package relative imports are correct, not violations of
    // the cross-package "use the workspace specifier" rule.
    files: ['shared/**/*.ts'],
    rules: {
      'no-restricted-imports': 'off',
    },
  },
  {
    // Phase F2: llm-egress-proxy is intentionally network-isolated. It must NOT
    // import from shared/ — neither via the workspace specifier nor via
    // relative paths. Re-implements equivalents in llm-egress-proxy/src/utils.ts.
    files: ['llm-egress-proxy/**/*.ts'],
    rules: {
      'no-restricted-imports': ['error', {
        patterns: [
          {
            group: [
              '@sanctuary/shared/**',
              '../shared/**',
              '../../shared/**',
              '../../../shared/**',
              '../../../../shared/**',
            ],
            message:
              'llm-egress-proxy is intentionally network-isolated; do not import from shared/. ' +
              'See shared/utils/README.md.',
          },
        ],
      }],
    },
  },
];

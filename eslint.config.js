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
];

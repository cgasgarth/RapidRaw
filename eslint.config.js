const js = require('@eslint/js');
const tseslint = require('typescript-eslint');
const react = require('eslint-plugin-react');
const reactHooks = require('eslint-plugin-react-hooks');
const i18next = require('eslint-plugin-i18next');

const tsFiles = ['**/*.{ts,tsx,mts}'];

const jsRecommendedForTs = {
  ...js.configs.recommended,
  files: tsFiles,
};

const tsStrictTypeChecked = tseslint.configs.strictTypeChecked.map((config) =>
  config.files ? config : { ...config, files: tsFiles },
);

const reactRecommended = {
  ...react.configs.flat.recommended,
  files: tsFiles,
};

const reactJsxRuntime = {
  ...react.configs.flat['jsx-runtime'],
  files: tsFiles,
};

const reactHooksRecommended = {
  ...reactHooks.configs.flat.recommended,
  files: tsFiles,
};

module.exports = [
  {
    linterOptions: {
      reportUnusedDisableDirectives: 'error',
    },
    ignores: [
      'dist/**',
      'node_modules/**',
      'src-tauri/target/**',
      'src-tauri/gen/**',
      'src-tauri/rawler/**',
      'data/**',
    ],
  },
  jsRecommendedForTs,
  ...tsStrictTypeChecked,
  reactRecommended,
  reactJsxRuntime,
  reactHooksRecommended,
  {
    files: tsFiles,
    plugins: {
      react,
      'react-hooks': reactHooks,
      i18next,
    },
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      parserOptions: {
        ecmaFeatures: {
          jsx: true,
        },
        projectService: {
          allowDefaultProject: ['*.ts'],
        },
        tsconfigRootDir: __dirname,
      },
    },
    settings: {
      react: {
        version: 'detect',
      },
    },
    rules: {
      'no-unused-vars': 'off',
      '@typescript-eslint/no-unused-vars': [
        'warn',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
      'react-hooks/rules-of-hooks': 'error',
      // Enable after the existing dependency-array warnings are fixed in a focused lint PR.
      'react-hooks/exhaustive-deps': 'off',
      // React compiler rules are enabled through the hooks recommended config,
      // with legacy violations split into focused cleanup issues.
      'react-hooks/set-state-in-effect': 'off',
      'react-hooks/refs': 'off',
      'react-hooks/static-components': 'off',
      'react-hooks/immutability': 'off',
      'react-hooks/preserve-manual-memoization': 'off',
      'react-hooks/purity': 'off',
      'react/prop-types': 'off',
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: 'ajv',
              message: 'Use Zod for TypeScript-facing runtime schemas and validation.',
            },
            {
              name: '@sinclair/typebox',
              message: 'Use Zod for TypeScript-facing runtime schemas and validation.',
            },
          ],
          patterns: [
            {
              group: ['ajv/*', '@sinclair/typebox/*'],
              message: 'Use Zod for TypeScript-facing runtime schemas and validation.',
            },
          ],
        },
      ],
      'no-restricted-syntax': [
        'error',
        {
          selector: "TSAsExpression[expression.type='TSAsExpression']",
          message: 'Do not use chained type assertions; add a real type guard or typed adapter.',
        },
      ],
      // Strict typed lint is enabled, but existing legacy violations are being
      // burned down by focused follow-up issues so this gate can land cleanly.
      '@typescript-eslint/no-confusing-void-expression': 'off',
      '@typescript-eslint/no-unnecessary-condition': 'off',
      '@typescript-eslint/restrict-template-expressions': 'off',
      '@typescript-eslint/unbound-method': 'off',
      '@typescript-eslint/no-misused-promises': 'off',
      '@typescript-eslint/no-floating-promises': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unnecessary-type-assertion': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/no-unsafe-enum-comparison': 'off',
      '@typescript-eslint/no-non-null-assertion': 'off',
      '@typescript-eslint/no-deprecated': 'off',
      '@typescript-eslint/use-unknown-in-catch-callback-variable': 'off',
      '@typescript-eslint/no-unnecessary-type-conversion': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-useless-default-assignment': 'off',
      '@typescript-eslint/no-unsafe-return': 'off',
      '@typescript-eslint/no-unnecessary-type-arguments': 'off',
      '@typescript-eslint/no-dynamic-delete': 'off',
      '@typescript-eslint/require-await': 'off',
      '@typescript-eslint/restrict-plus-operands': 'off',
      '@typescript-eslint/no-unnecessary-boolean-literal-compare': 'off',
      '@typescript-eslint/no-unnecessary-type-parameters': 'off',
      'i18next/no-literal-string': [
        'warn',
        {
          markupOnly: true,
          ignoreAttribute: [
            'className',
            'style',
            'data-tooltip',
            'variant',
            'size',
            'color',
            'weight',
            'fillOrigin',
            'id',
            'name',
            'type',
            'value',
            'label',
            'placeholder',
            'stroke',
            'fill',
            'viewBox',
          ],
        },
      ],
    },
  },
];

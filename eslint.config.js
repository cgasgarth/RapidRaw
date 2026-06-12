const js = require('@eslint/js');
const tseslint = require('typescript-eslint');
const react = require('eslint-plugin-react');
const reactHooks = require('eslint-plugin-react-hooks');
const jsxA11y = require('eslint-plugin-jsx-a11y');
const importX = require('eslint-plugin-import-x');
const boundaries = require('eslint-plugin-boundaries');
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

const jsxA11yRecommended = {
  ...jsxA11y.flatConfigs.recommended,
  files: tsFiles,
};

const importXRecommended = {
  ...importX.flatConfigs.recommended,
  files: tsFiles,
};

const importXTypeScript = {
  ...importX.flatConfigs.typescript,
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
  jsxA11yRecommended,
  importXRecommended,
  importXTypeScript,
  {
    files: tsFiles,
    plugins: {
      react,
      'react-hooks': reactHooks,
      boundaries,
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
      'boundaries/elements': [
        { type: 'entry', pattern: 'src/main.tsx' },
        { type: 'app', pattern: 'src/App.tsx' },
        { type: 'views', pattern: 'src/components/views/**' },
        { type: 'panels', pattern: 'src/components/panel/**' },
        { type: 'adjustments', pattern: 'src/components/adjustments/**' },
        { type: 'modals', pattern: 'src/components/modals/**' },
        { type: 'managers', pattern: 'src/components/managers/**' },
        { type: 'ui', pattern: 'src/components/ui/**' },
        { type: 'context', pattern: 'src/context/**' },
        { type: 'hooks', pattern: 'src/hooks/**' },
        { type: 'schemas', pattern: 'src/schemas/**' },
        { type: 'store', pattern: 'src/store/**' },
        { type: 'types', pattern: 'src/types/**' },
        { type: 'utils', pattern: 'src/utils/**' },
        { type: 'i18n', pattern: 'src/i18n/**' },
        { type: 'window', pattern: 'src/window/**' },
      ],
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
      'react-hooks/static-components': 'error',
      'react-hooks/immutability': 'off',
      'react-hooks/preserve-manual-memoization': 'off',
      'react-hooks/purity': 'off',
      'react/prop-types': 'off',
      // Accessibility lint is enabled, but legacy interactive element patterns
      // are tracked separately so this gate can land without broad UI rewrites.
      'jsx-a11y/no-static-element-interactions': 'off',
      'jsx-a11y/click-events-have-key-events': 'off',
      'jsx-a11y/no-autofocus': 'error',
      'jsx-a11y/no-noninteractive-element-interactions': 'error',
      'import-x/no-duplicates': 'error',
      'import-x/no-self-import': 'error',
      'import-x/no-useless-path-segments': ['error', { noUselessIndex: true }],
      // Import order and boundary enforcement are enabled incrementally after
      // the current module graph is measured and split into focused PRs.
      'import-x/no-named-as-default': 'off',
      'import-x/no-named-as-default-member': 'error',
      'import-x/order': 'off',
      'import-x/no-cycle': 'off',
      'boundaries/element-types': 'error',
      'boundaries/entry-point': 'error',
      'boundaries/dependencies': 'off',
      'boundaries/no-unknown': 'off',
      'boundaries/no-unknown-files': 'off',
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
      '@typescript-eslint/no-unsafe-enum-comparison': 'error',
      '@typescript-eslint/no-non-null-assertion': 'error',
      '@typescript-eslint/no-deprecated': 'error',
      '@typescript-eslint/no-unnecessary-type-conversion': 'error',
      '@typescript-eslint/use-unknown-in-catch-callback-variable': 'error',
      '@typescript-eslint/no-unsafe-call': 'error',
      '@typescript-eslint/no-useless-default-assignment': 'error',
      '@typescript-eslint/no-unsafe-return': 'error',
      '@typescript-eslint/no-unnecessary-type-arguments': 'error',
      '@typescript-eslint/no-dynamic-delete': 'error',
      '@typescript-eslint/require-await': 'error',
      '@typescript-eslint/restrict-plus-operands': 'error',
      '@typescript-eslint/no-unnecessary-boolean-literal-compare': 'error',
      '@typescript-eslint/no-unnecessary-type-parameters': 'error',
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

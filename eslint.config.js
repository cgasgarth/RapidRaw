const { fixupPluginRules } = require('@eslint/compat');
const js = require('@eslint/js');
const tseslint = require('typescript-eslint');
const react = require('eslint-plugin-react');
const reactHooks = require('eslint-plugin-react-hooks');
const { reactRefresh } = require('eslint-plugin-react-refresh');
const jsxA11y = require('eslint-plugin-jsx-a11y');
const importX = require('eslint-plugin-import-x');
const boundaries = require('eslint-plugin-boundaries');
const i18next = require('eslint-plugin-i18next');

const tsFiles = ['**/*.{ts,tsx,mts}'];
const scriptLikeTsFiles = ['scripts/**/*.ts', 'tests/**/*.ts', 'packages/*/scripts/**/*.ts'];
const reactRefreshFiles = ['**/*.{tsx,jsx}'];
const publicApiSignatureFiles = [
  'packages/rawengine-schema/src/**/*.ts',
  'src/schemas/**/*.ts',
  'src/utils/tauriSchemaInvoke.ts',
];
const boundaryElement = (type, pattern) => ({ mode: 'full', pattern, type });
const reactPlugin = fixupPluginRules(react);
const reactHooksPlugin = fixupPluginRules(reactHooks);
const reactRefreshPlugin = fixupPluginRules(reactRefresh.plugin);
const jsxA11yPlugin = fixupPluginRules(jsxA11y);
const importXPlugin = fixupPluginRules(importX);
const boundariesPlugin = fixupPluginRules(boundaries);
const i18nextPlugin = fixupPluginRules(i18next);

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
  plugins: {
    ...react.configs.flat.recommended.plugins,
    react: reactPlugin,
  },
};

const reactJsxRuntime = {
  ...react.configs.flat['jsx-runtime'],
  files: tsFiles,
  plugins: {
    ...react.configs.flat['jsx-runtime'].plugins,
    react: reactPlugin,
  },
};

const reactHooksRecommended = {
  ...reactHooks.configs.flat.recommended,
  files: tsFiles,
  plugins: {
    ...reactHooks.configs.flat.recommended.plugins,
    'react-hooks': reactHooksPlugin,
  },
};

const jsxA11yRecommended = {
  ...jsxA11y.flatConfigs.recommended,
  files: tsFiles,
  plugins: {
    ...jsxA11y.flatConfigs.recommended.plugins,
    'jsx-a11y': jsxA11yPlugin,
  },
};

const importXRecommended = {
  ...importX.flatConfigs.recommended,
  files: tsFiles,
  plugins: {
    ...importX.flatConfigs.recommended.plugins,
    'import-x': importXPlugin,
  },
};

const importXTypeScript = {
  ...importX.flatConfigs.typescript,
  files: tsFiles,
  plugins: {
    ...importX.flatConfigs.typescript.plugins,
    'import-x': importXPlugin,
  },
};

module.exports = [
  {
    ignores: [
      'dist/**',
      'node_modules/**',
      'src-tauri/target/**',
      'src-tauri/gen/**',
      'src-tauri/rawler/**',
      'data/**',
    ],
  },
  {
    linterOptions: {
      reportUnusedDisableDirectives: 'error',
    },
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
    files: reactRefreshFiles,
    ignores: ['src/utils/CollageVariants.tsx'],
    plugins: {
      'react-refresh': reactRefreshPlugin,
    },
    rules: {
      'react-refresh/only-export-components': [
        'error',
        {
          allowConstantExport: true,
          // The context hook is intentionally exported with its provider.
          allowExportNames: ['useContextMenu'],
        },
      ],
    },
  },
  {
    files: tsFiles,
    plugins: {
      '@typescript-eslint': tseslint.plugin,
      react: reactPlugin,
      'react-hooks': reactHooksPlugin,
      boundaries: boundariesPlugin,
      i18next: i18nextPlugin,
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
        boundaryElement('config', '*.config.ts'),
        boundaryElement('entry', 'src/main.tsx'),
        boundaryElement('app', 'src/App.tsx'),
        boundaryElement('validation', 'src/validation/**'),
        boundaryElement('views', 'src/components/views/**'),
        boundaryElement('panels', 'src/components/panel/**'),
        boundaryElement('adjustments', 'src/components/adjustments/**'),
        boundaryElement('modals', 'src/components/modals/**'),
        boundaryElement('managers', 'src/components/managers/**'),
        boundaryElement('ui', 'src/components/ui/**'),
        boundaryElement('context', 'src/context/**'),
        boundaryElement('hooks', 'src/hooks/**'),
        boundaryElement('schemas', 'src/schemas/**'),
        boundaryElement('store', 'src/store/**'),
        boundaryElement('types', 'src/types/**'),
        boundaryElement('declarations', 'src/@types/**'),
        boundaryElement('utils', 'src/utils/**'),
        boundaryElement('i18n', 'src/i18n/**'),
        boundaryElement('window', 'src/window/**'),
        boundaryElement('scripts', 'scripts/**'),
        boundaryElement('tests', 'tests/**'),
        boundaryElement('schema-package-scripts', 'packages/rawengine-schema/scripts/**'),
        boundaryElement('schema-package', 'packages/rawengine-schema/src/**'),
      ],
    },
    rules: {
      'no-unused-vars': 'off',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { fixStyle: 'inline-type-imports', prefer: 'type-imports' },
      ],
      '@typescript-eslint/consistent-type-exports': 'error',
      '@typescript-eslint/no-import-type-side-effects': 'error',
      'react-hooks/rules-of-hooks': 'error',
      // Enable after the existing dependency-array warnings are fixed in a focused lint PR.
      'react-hooks/exhaustive-deps': 'error',
      'react-hooks/set-state-in-effect': 'error',
      'react-hooks/refs': 'error',
      'react-hooks/static-components': 'error',
      'react-hooks/immutability': 'error',
      'react-hooks/preserve-manual-memoization': 'error',
      'react-hooks/purity': 'error',
      'react/prop-types': 'off',
      'jsx-a11y/no-static-element-interactions': 'error',
      'jsx-a11y/click-events-have-key-events': 'error',
      'jsx-a11y/no-autofocus': 'error',
      'jsx-a11y/no-noninteractive-element-interactions': 'error',
      'import-x/no-duplicates': 'error',
      'import-x/no-self-import': 'error',
      'import-x/no-useless-path-segments': ['error', { noUselessIndex: true }],
      // Import order and boundary enforcement are enabled incrementally after
      // the current module graph is measured and split into focused PRs.
      'import-x/no-named-as-default': 'error',
      'import-x/no-named-as-default-member': 'error',
      'import-x/order': [
        'error',
        {
          groups: ['builtin', 'external', 'internal', ['parent', 'sibling', 'index'], 'object', 'type'],
          alphabetize: { order: 'asc', caseInsensitive: true },
          'newlines-between': 'always',
        },
      ],
      'import-x/no-cycle': 'off',
      'boundaries/element-types': 'error',
      'boundaries/entry-point': 'error',
      'boundaries/dependencies': 'error',
      'boundaries/no-unknown': 'off',
      'boundaries/no-unknown-files': 'error',
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
      '@typescript-eslint/ban-ts-comment': [
        'error',
        {
          minimumDescriptionLength: 12,
          'ts-check': false,
          'ts-expect-error': 'allow-with-description',
          'ts-ignore': true,
          'ts-nocheck': true,
        },
      ],
      '@typescript-eslint/no-confusing-void-expression': 'error',
      '@typescript-eslint/no-unnecessary-condition': 'error',
      '@typescript-eslint/restrict-template-expressions': [
        'error',
        {
          allowAny: false,
          allowBoolean: false,
          allowNever: false,
          allowNullish: false,
          allowNumber: true,
          allowRegExp: false,
        },
      ],
      '@typescript-eslint/unbound-method': 'error',
      '@typescript-eslint/no-misused-promises': 'error',
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/switch-exhaustiveness-check': 'error',
      '@typescript-eslint/no-unsafe-member-access': 'error',
      '@typescript-eslint/no-unsafe-assignment': 'error',
      '@typescript-eslint/no-unnecessary-type-assertion': 'error',
      '@typescript-eslint/no-unsafe-argument': 'error',
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
      '@typescript-eslint/consistent-indexed-object-style': 'error',
      '@typescript-eslint/prefer-for-of': 'error',
      '@typescript-eslint/prefer-regexp-exec': 'error',
      'i18next/no-literal-string': [
        'error',
        {
          markupOnly: false,
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
  {
    files: publicApiSignatureFiles,
    rules: {
      '@typescript-eslint/explicit-function-return-type': [
        'error',
        {
          allowExpressions: true,
          allowFunctionsWithoutTypeParameters: true,
          allowTypedFunctionExpressions: true,
        },
      ],
      '@typescript-eslint/typedef': [
        'error',
        {
          memberVariableDeclaration: true,
          parameter: true,
          propertyDeclaration: true,
          variableDeclaration: false,
        },
      ],
    },
  },
  {
    ...tseslint.configs.disableTypeChecked,
    files: scriptLikeTsFiles,
    rules: {
      ...tseslint.configs.disableTypeChecked.rules,
      '@typescript-eslint/ban-ts-comment': [
        'error',
        {
          minimumDescriptionLength: 12,
          'ts-check': false,
          'ts-expect-error': 'allow-with-description',
          'ts-ignore': true,
          'ts-nocheck': true,
        },
      ],
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
      'boundaries/dependencies': 'off',
      'boundaries/element-types': 'off',
      'boundaries/entry-point': 'off',
      'i18next/no-literal-string': 'off',
      'import-x/no-cycle': 'off',
      'import-x/no-named-as-default-member': 'off',
      'import-x/no-unresolved': 'off',
      'import-x/order': 'off',
      'preserve-caught-error': 'off',
    },
  },
];

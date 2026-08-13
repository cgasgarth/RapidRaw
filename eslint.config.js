const js = require('@eslint/js');
const tseslint = require('typescript-eslint');
const react = require('eslint-plugin-react');
const i18next = require('eslint-plugin-i18next');

const tsFiles = ['**/*.{ts,tsx}'];

const jsRecommendedForTs = {
  ...js.configs.recommended,
  files: tsFiles,
};

const tsStrict = tseslint.configs.strict.map((config) =>
  config.files ? config : { ...config, files: tsFiles },
);

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
  jsRecommendedForTs,
  ...tsStrict,
  {
    files: tsFiles,
    plugins: {
      react,
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
          allowDefaultProject: ['i18next.config.ts'],
        },
      },
    },
    settings: {
      react: {
        version: 'detect',
      },
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unnecessary-condition': 'error',
      'prefer-const': 'error',
      'no-unused-vars': 'off',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
      'i18next/no-literal-string': [
        'error',
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
            'href',
            'target',
            'rel',
          ],
          ignoreComponent: ['code'],
        },
      ],
    },
  },
];

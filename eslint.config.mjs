import js from '@eslint/js';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';
import tseslint from 'typescript-eslint';

const VENDOR_IMPORTS = {
  group: ['@supabase/*', '@vercel/*'],
  message:
    'Привязка к поставщику: @supabase/* и @vercel/* разрешены только в packages/adapters (см. CLAUDE.md).',
};

/** Русские буквы в строке кода интерфейса — текст мимо словаря. */
const CYRILLIC = '/[А-яЁё]/';
const L10N_MESSAGE =
  'Текст интерфейса — только из словаря: ключ в UI_TEXTS (@buhuchet/domain), на экране t(ключ) из useT() или getT() (CLAUDE.md, «Локализация»).';

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/.next/**',
      '**/dist/**',
      '**/coverage/**',
      '**/.turbo/**',
      'spec/**',
      'packages/db/migrations/**',
      '**/next-env.d.ts',
      'playwright-report/**',
      'test-results/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      globals: { ...globals.node },
    },
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/consistent-type-imports': ['error', { fixStyle: 'inline-type-imports' }],
      'no-restricted-imports': ['error', { patterns: [VENDOR_IMPORTS] }],
    },
  },
  {
    files: ['packages/adapters/**'],
    rules: { 'no-restricted-imports': 'off' },
  },
  {
    files: ['packages/domain/src/**'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            VENDOR_IMPORTS,
            {
              group: [
                '@buhuchet/db',
                '@buhuchet/db/*',
                '@buhuchet/adapters',
                '@buhuchet/adapters/*',
                '@buhuchet/api',
                '@buhuchet/api/*',
              ],
              message: 'packages/domain — чистые правила без базы, сети и переходников.',
            },
            {
              group: ['hono', 'hono/*', 'drizzle-orm', 'drizzle-orm/*', 'postgres', 'node:*'],
              message: 'packages/domain — без базы, сети и Node API.',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['apps/web/**/*.{ts,tsx}', 'packages/ui/**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks },
    languageOptions: { globals: { ...globals.browser, ...globals.node } },
    rules: reactHooks.configs.recommended.rules,
  },
  {
    // Тексты интерфейса — только из словаря (модуль «Локализация»): строк с русскими буквами в коде
    // сайта и общих компонентов нет. Комментарии и названия тестов — можно.
    files: ['apps/web/**/*.{ts,tsx}', 'packages/ui/**/*.{ts,tsx}'],
    ignores: ['**/*.test.{ts,tsx}'],
    rules: {
      'no-restricted-syntax': [
        'error',
        { selector: `Literal[value=${CYRILLIC}]`, message: L10N_MESSAGE },
        { selector: `TemplateElement[value.raw=${CYRILLIC}]`, message: L10N_MESSAGE },
        { selector: `JSXText[value=${CYRILLIC}]`, message: L10N_MESSAGE },
      ],
    },
  },
);

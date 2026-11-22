import js from '@eslint/js';
import tseslint from 'typescript-eslint';

/**
 * Source lint for the UDG-001 foundation.
 *
 * tests/fixtures/** is excluded on purpose: those trees are checker *data*, deliberately invalid,
 * and are validated by `pnpm test:boundaries` instead. Boundary and cycle rules are not ESLint
 * rules; they are enforced by tools/checks/src/boundaries.ts via `pnpm lint:boundaries`.
 */
export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      'artifacts/**',
      'coverage/**',
      'tests/fixtures/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.ts', '**/*.mts', '**/*.cts'],
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: 'module',
    },
    rules: {
      'eqeqeq': ['error', 'always'],
      'no-empty': ['error', { allowEmptyCatch: false }],
      'prefer-const': 'error',
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      '@typescript-eslint/no-unused-expressions': 'error',
      '@typescript-eslint/consistent-type-imports': ['error', { prefer: 'type-imports' }],
    },
  },
  {
    files: ['**/*.mjs'],
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: 'module',
    },
  },
);

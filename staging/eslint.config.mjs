/**
 * ESLint config cascade for staging/*.mjs — Node-run release-integration scripts (launcher,
 * smoke CLI, packagers). The ROOT eslint.config.mjs is pinned byte-identical by the UDG-004
 * contract suite, so the Node ambient globals these scripts legitimately use are declared in
 * this NESTED config file instead (ESLint v9 cascades config files under the working
 * directory). Scoped to this directory on purpose: nothing outside staging/ gains these
 * globals, and the globals listed are exactly the runtime surface the scripts touch.
 */
export default [
  {
    files: ['**/*.mjs'],
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: 'module',
      globals: {
        process: 'readonly',
        performance: 'readonly',
        URL: 'readonly',
        setTimeout: 'readonly',
      },
    },
  },
];

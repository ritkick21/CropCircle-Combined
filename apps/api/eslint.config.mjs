import base from '../../packages/config/eslint/base.mjs';
import globals from 'globals';

export default [
  { ignores: ['dist/**', 'node_modules/**', 'eslint.config.mjs'] },
  ...base,
  {
    files: ['**/*.ts'],
    languageOptions: { globals: globals.node },
  },
];

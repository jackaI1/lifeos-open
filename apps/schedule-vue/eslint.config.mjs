import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import pluginVue from 'eslint-plugin-vue';

export default tseslint.config(
  {ignores: ['dist/**', 'public/demo/**', 'coverage/**']},
  js.configs.recommended,
  ...tseslint.configs.recommended,
  ...pluginVue.configs['flat/recommended'],
  {languageOptions: {globals: globals.node}, files: ['scripts/**/*.mjs', '*.config.*', 'eslint.config.mjs']},
  {
    files: ['**/*.vue'],
    languageOptions: {parserOptions: {parser: tseslint.parser}},
    rules: {
      'vue/max-attributes-per-line': 'off',
      'vue/singleline-html-element-content-newline': 'off',
      'vue/html-self-closing': 'off',
    },
  },
);

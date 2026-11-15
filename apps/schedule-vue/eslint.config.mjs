import js from '@eslint/js';
import pluginVue from 'eslint-plugin-vue';
import tseslint from 'typescript-eslint';
import vueParser from 'vue-eslint-parser';

// Stylistic Vue template rules are off: the templates are short and read clearly on one line.
const browserGlobals = {fetch: 'readonly', navigator: 'readonly', window: 'readonly', document: 'readonly', Response: 'readonly', TypeError: 'readonly'};

export default tseslint.config(
  {ignores: ['dist/**', 'node_modules/**']},
  js.configs.recommended,
  ...tseslint.configs.recommended,
  ...pluginVue.configs['flat/recommended'],
  {
    files: ['**/*.vue'],
    languageOptions: {parser: vueParser, parserOptions: {parser: tseslint.parser, extraFileExtensions: ['.vue']}},
    rules: {
      'vue/max-attributes-per-line': 'off',
      'vue/singleline-html-element-content-newline': 'off',
      'vue/html-self-closing': 'off',
    },
  },
  {files: ['**/*.ts', '**/*.vue'], languageOptions: {globals: browserGlobals}},
);

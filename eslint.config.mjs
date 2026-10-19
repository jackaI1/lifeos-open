import tseslint from 'typescript-eslint';
export default [
 {ignores:['public/vendor/**','build/**','node_modules/**','.local/**','docs/**']},
 {files:['**/*.{js,mjs}'],languageOptions:{ecmaVersion:2023,sourceType:'module'},rules:{'no-unreachable':'error','no-dupe-args':'error','no-dupe-else-if':'error','valid-typeof':'error','no-unsafe-finally':'error'}},
 {files:['**/*.ts'],languageOptions:{parser:tseslint.parser,ecmaVersion:2023,sourceType:'module'},rules:{'no-unreachable':'error','valid-typeof':'error'}}
];

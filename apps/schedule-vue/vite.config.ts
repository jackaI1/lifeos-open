import {fileURLToPath, URL} from 'node:url';
import {defineConfig} from 'vite';
import vue from '@vitejs/plugin-vue';

// The public demo feed is the same file the static demo serves. Vite serves it at /today.json.
const demoFeed = fileURLToPath(new URL('../../public/demo', import.meta.url));

export default defineConfig({
  plugins: [vue()],
  publicDir: demoFeed,
  server: {fs: {allow: ['../..']}},
  test: {environment: 'jsdom', include: ['test/**/*.test.ts']},
});

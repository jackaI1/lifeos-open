import {fileURLToPath} from 'node:url';
import {defineConfig} from 'vitest/config';
// React view tests run against the real shell modules in public/ (aliased as @shell).
export default defineConfig({
  resolve:{alias:[{find:/^@shell\/(.*)$/,replacement:fileURLToPath(new URL('./public/$1',import.meta.url))}]},
  esbuild:{jsx:'automatic'},
  test:{environment:'jsdom',include:['src/frontend/react/**/*.test.{ts,tsx}'],setupFiles:['src/frontend/react/test/setup.ts'],restoreMocks:true}
});

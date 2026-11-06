import {build} from 'esbuild';
await build({entryPoints: ['src/functions.ts'], bundle: true, packages: 'external', platform: 'node', target: 'node22', format: 'esm', outfile: 'dist/functions.mjs'});

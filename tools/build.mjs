import {build} from 'esbuild';
import {mkdir} from 'node:fs/promises';
await mkdir('build',{recursive:true});
await build({entryPoints:['src/local/main.ts'],bundle:true,platform:'node',target:'node24',format:'esm',packages:'external',outfile:'build/server.mjs',sourcemap:false,legalComments:'inline'});
await build({entryPoints:['src/frontend/document-runtime.mjs'],bundle:true,platform:'browser',target:'es2022',format:'esm',outfile:'public/vendor/document-runtime.mjs',sourcemap:false,legalComments:'inline'});
console.log('Built standalone server and document editor. Public ESM modules are served without transformation.');

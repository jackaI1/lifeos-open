import {build} from 'esbuild';
import {mkdir} from 'node:fs/promises';
import {gzipSync} from 'node:zlib';
await mkdir('build',{recursive:true});
await build({entryPoints:['src/local/main.ts'],bundle:true,platform:'node',target:'node24',format:'esm',packages:'external',outfile:'build/server.mjs',sourcemap:false,legalComments:'inline'});
await build({entryPoints:['src/frontend/document-runtime.mjs'],bundle:true,platform:'browser',target:'es2022',format:'esm',outfile:'public/vendor/document-runtime.mjs',sourcemap:false,legalComments:'inline'});
await build({entryPoints:['src/analytics/index.ts'],bundle:true,platform:'browser',target:'es2022',format:'esm',outfile:'public/vendor/analytics.mjs',sourcemap:false,legalComments:'inline'});
// React views: `@shell/x.js` imports stay external and resolve to public/x.js at runtime,
// so the bundle shares the shell's live module instances. Add one entry per migrated view;
// splitting puts React itself in a shared chunk. See docs/react-migration.md.
const shell={name:'lifeos-shell',setup(b){b.onResolve({filter:/^@shell\//},args=>({path:'../'+args.path.slice('@shell/'.length),external:true}));}};
const react=await build({entryPoints:{finances:'src/frontend/react/finances/index.tsx'},outdir:'public/react',outExtension:{'.js':'.mjs'},splitting:true,chunkNames:'chunks/[name]-[hash]',bundle:true,platform:'browser',target:'es2022',format:'esm',jsx:'automatic',minify:true,define:{'process.env.NODE_ENV':'"production"'},plugins:[shell],sourcemap:false,legalComments:'eof',metafile:true,logLevel:'warning'});
for(const [file,{bytes}] of Object.entries(react.metafile.outputs)){const {readFileSync}=await import('node:fs');console.log(`${file}: ${(bytes/1024).toFixed(1)} KiB, ${(gzipSync(readFileSync(file)).length/1024).toFixed(1)} KiB gzip`);}
console.log('Built standalone server, document editor and React views. Public ESM modules are served without transformation.');

// Original demo narration. The optional generator is a build tool, never shipped.
// Usage: node tools/generate-demo-audio.mjs /path/to/espeak-ng/dist/espeak-ng.js
import {readFile,writeFile} from 'node:fs/promises';
import {resolve,dirname,join} from 'node:path';
import {pathToFileURL} from 'node:url';
const entry=resolve(process.argv[2]);
const {default:ESpeakNg}=await import(pathToFileURL(entry).href);
const text='A feedback loop returns information about an output to influence a future input. Negative feedback reduces a deviation. Positive feedback amplifies it.';
const engine=await ESpeakNg({wasmBinary:await readFile(join(dirname(entry),'espeak-ng.wasm')),arguments:['-w','lecture.wav','-s','160','-v','en-us',text]});
await writeFile('public/demo-lecture.wav',engine.FS.readFile('lecture.wav'));

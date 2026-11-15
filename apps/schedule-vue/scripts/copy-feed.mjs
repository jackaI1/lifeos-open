// Copies only the public demo feed into public/ so Vite serves it at /demo/today.json.
// The copy is generated and git-ignored; the feed itself stays in the repository root.
import {copyFile, mkdir} from 'node:fs/promises';
const source = new URL('../../../public/demo/today.json', import.meta.url);
const target = new URL('../public/demo/today.json', import.meta.url);
await mkdir(new URL('../public/demo/', import.meta.url), {recursive: true});
await copyFile(source, target);
console.log('copied the public demo feed');

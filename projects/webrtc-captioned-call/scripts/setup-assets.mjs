import { mkdir, readFile, writeFile, readdir, copyFile, rename } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
const root = path.resolve(import.meta.dirname,'..');
const manifest = JSON.parse(await readFile(path.join(root,'scripts/model-manifest.json'),'utf8'));
for (const file of manifest.files) {
  const target = path.join(root,'public/models',manifest.model,file.path);
  await mkdir(path.dirname(target),{recursive:true});
  let existing;
  try { existing = await readFile(target); } catch { /* first setup */ }
  if (existing && createHash('sha256').update(existing).digest('hex') === file.sha256) continue;
  const url = `https://huggingface.co/${manifest.model}/resolve/${manifest.revision}/${file.path}`;
  const response = await fetch(url, {signal:AbortSignal.timeout(180_000)});
  if (!response.ok) throw new Error(`Model download failed (${response.status}): ${file.path}`);
  const data = Buffer.from(await response.arrayBuffer());
  if (createHash('sha256').update(data).digest('hex') !== file.sha256) throw new Error(`Checksum mismatch: ${file.path}`);
  await writeFile(`${target}.tmp`,data); await rename(`${target}.tmp`,target);
  console.log(`Prepared ${file.path} (${(data.length/1e6).toFixed(1)} MB)`);
}
const wasmDir = path.join(root,'node_modules/onnxruntime-web/dist');
await mkdir(path.join(root,'public/wasm'),{recursive:true});
for (const filename of await readdir(wasmDir)) {
  if (/^ort-wasm.*\.(wasm|mjs)$/.test(filename)) await copyFile(path.join(wasmDir,filename),path.join(root,'public/wasm',filename));
}
console.log('Local Whisper and WASM assets ready. Run setup before build to include them in dist.');

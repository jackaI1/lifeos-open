import {mkdtempSync, writeFileSync, rmSync, realpathSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, relative, resolve, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';

const [target, image] = process.argv.slice(2);
if (!['base', 'kind', 'ci'].includes(target)) throw new Error('Choose base, kind or ci');
const match = /^([a-z0-9./_-]+)(?::([a-zA-Z0-9_.-]+)|@(sha256:[a-f0-9]{64}))$/.exec(image ?? '');
if (!match) throw new Error('Pass a complete image tag or sha256 digest');
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const overlay = resolve(root, 'deploy/kubernetes', target === 'base' ? 'base' : 'overlays/' + target);
const scratch = realpathSync(mkdtempSync(join(tmpdir(), 'lifeos-kustomize-')));
try {
 // A wrapper overlay preserves Namespace/ConfigMap/Service/PVC as well as Deployment.
 // JSON is valid YAML and safely quotes paths, including checkout paths with spaces.
 writeFileSync(join(scratch, 'kustomization.yaml'), JSON.stringify({
  apiVersion:'kustomize.config.k8s.io/v1beta1', kind:'Kustomization',
  resources:[relative(scratch, realpathSync(overlay))],
  images:['ghcr.io/jackai1/lifeos-open', 'lifeos-open'].map(name => ({
   name, newName:match[1], ...(match[2] ? {newTag:match[2]} : {digest:match[3]}),
  })),
 }));
 process.stdout.write(execFileSync('kubectl', ['kustomize', scratch], {encoding:'utf8', maxBuffer:1024*1024}));
} finally {
 rmSync(scratch, {recursive:true, force:true});
}

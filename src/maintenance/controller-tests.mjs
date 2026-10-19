import { mkdtemp, readFile, readdir, rmdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { runProcess, maintenanceEnvironment } from './process.mjs';
import { sha256, isInside } from './policy.mjs';

/** This path is selected by the installed controller, never by a report or candidate. */
export async function verifyControllerTests({ directory, worktree, signal }) {
  const controllerDirectory=dirname(fileURLToPath(import.meta.url)),repository=resolve(controllerDirectory,'../..'),testPath=join(repository,'test/maintenance.test.mjs');
  if(repository===worktree||isInside(worktree,repository))throw Error('Trusted controller tests cannot execute from a candidate worktree');
  const fingerprints={};
  for(const file of await readdir(controllerDirectory))if(file.endsWith('.mjs'))fingerprints[`src/maintenance/${file}`]=sha256(await readFile(join(controllerDirectory,file)));
  const testPaths=[testPath,...(await readdir(join(repository,'test'))).filter(name=>/^cloud-.*\.test\.mjs$/.test(name)).map(name=>join(repository,'test',name))];
  for(const path of testPaths)fingerprints['test/'+path.split(/[\\/]/).at(-1)]=sha256(await readFile(path));
  for(const folder of ['cloud','shared','domain'])for(const file of await readdir(join(repository,'src',folder)))if(/\.(mjs|sql)$/.test(file))fingerprints[`src/${folder}/${file}`]=sha256(await readFile(join(repository,'src',folder,file)));
  const temporaryDirectory=await mkdtemp(join(tmpdir(),'lifeos-mct-'));
  const startedAt=new Date().toISOString();let result;
  try{result=await runProcess(process.execPath,['--test','--test-concurrency=1','--test-reporter=tap',...testPaths],{cwd:repository,env:maintenanceEnvironment(process.env,temporaryDirectory),timeoutMs:240000,signal,allowFailure:true});}
  finally{await rmdir(temporaryDirectory).catch(()=>{});} // Remove only the empty directory this controller just created.
  const log=result.stdout+'\n'+result.stderr,logFile=join(directory,'controller-tests.txt');await writeFile(logFile,log);
  for(const [path,hash] of Object.entries(fingerprints))if(sha256(await readFile(join(repository,path)))!==hash)throw Error('Installed controller changed during its verification');
  const tests=Number(log.match(/# tests (\d+)/)?.[1]??0);
  return {status:result.code===0&&tests>0?'passed':'failed',tests,exitCode:result.code,startedAt,finishedAt:new Date().toISOString(),logFile,logSha256:sha256(log),authority:'trusted-unchanged-controller-synthetic-fixtures',fingerprints};
}

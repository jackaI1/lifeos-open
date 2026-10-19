import {isAbsolute,resolve} from 'node:path';

export function modelRuntime(config,{platform=process.platform,root,env=process.env}={}) {
 // Legacy Windows service configurations may be supplied by the supervisor.
 // They did not configure the model server before the Mac port.
 if(!config||(platform==='win32'&&!Object.hasOwn(config,'ollamaExe')&&!Object.hasOwn(config,'modelDir'))){
  if(platform!=='win32')throw Error('Explicit native model configuration is required');
  const stateDir=resolve(root,'.lifeos/local-model');
  config={stateDir,modelDir:resolve(stateDir,'models'),ollamaExe:resolve(stateDir,'ollama-0.34.0/ollama.exe')};
 }
 for(const value of [config.ollamaExe,config.modelDir,config.stateDir])if(typeof value!=='string'||!isAbsolute(value)||/[\r\n\0]/.test(value))throw Error('Local model paths must be absolute');
 const childEnv={...env,OLLAMA_HOST:'127.0.0.1:11434',OLLAMA_NO_CLOUD:'1',OLLAMA_MODELS:config.modelDir,OLLAMA_CONTEXT_LENGTH:'8192',OLLAMA_NUM_PARALLEL:'1',OLLAMA_MAX_LOADED_MODELS:'1',OLLAMA_KEEP_ALIVE:'2m'};
 for(const key of Object.keys(childEnv))if(/API_KEY|TOKEN|SECRET/i.test(key))delete childEnv[key];
 return {executable:config.ollamaExe,stateDir:config.stateDir,env:childEnv};
}

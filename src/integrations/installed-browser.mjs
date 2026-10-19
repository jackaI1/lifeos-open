// Read the vendor's installed MCP configuration afresh after Desktop runtime updates.
// No credentials, cookie stores, debug ports or private browser transports are read here.
import {readFile,readdir,lstat,realpath} from 'node:fs/promises';
import {join,resolve,relative,isAbsolute} from 'node:path';
import {homedir} from 'node:os';
import {createHash} from 'node:crypto';
const inside=(root,path)=>{const r=relative(resolve(root),resolve(path));return !!r&&!r.startsWith('..')&&!isAbsolute(r);};
export async function installedBrowserRuntime({pluginRoot=join(process.env.LLM_HOME??join(homedir(),'.ai'),'plugins/cache/openai-bundled/unified-computer-use'),runtimeRoot,platform=process.platform,appRoots=['/Applications/ChatGPT.app','/Applications/AI.app']}={}){
 const entries=await readdir(pluginRoot,{withFileTypes:true}),candidates=[];
 for(const entry of entries){if(!entry.isDirectory()||entry.isSymbolicLink())continue;const file=join(pluginRoot,entry.name,'.mcp.json');try{const stat=await lstat(file);if(stat.isFile()&&!stat.isSymbolicLink())candidates.push({file,at:stat.mtimeMs});}catch{}}
 candidates.sort((a,b)=>b.at-a.at);if(!candidates.length)throw Error('The installed AI browser configuration is unavailable');
 const path=candidates[0].file,raw=await readFile(path,'utf8'),mcp=JSON.parse(raw).mcpServers?.cua_repl;
 if(!runtimeRoot){
  const roots=platform==='darwin'?appRoots.map(root=>join(root,'Contents/Resources/cua_node')):[join(process.env.LOCALAPPDATA??'','OpenAI/AI/runtimes/cua_node')];
  runtimeRoot=roots.find(root=>typeof mcp?.command==='string'&&inside(root,mcp.command));
 }
 if(!runtimeRoot)throw Error('Unexpected installed browser command');
 if(!mcp||!isAbsolute(mcp.command)||!inside(runtimeRoot,mcp.command)||!Array.isArray(mcp.args)||mcp.args.length!==1||!inside(runtimeRoot,mcp.args[0])||!/[\\/]node_modules[\\/]@oai[\\/]cua-repl[\\/]bin[\\/]cua-repl\.mjs$/.test(mcp.args[0]))throw Error('Unexpected installed browser command');
 for(const file of [mcp.command,mcp.args[0],mcp.env?.CUA_REPL_NODE_REPL_PATH]){if(typeof file!=='string'||!inside(runtimeRoot,file)||!(await lstat(file)).isFile()||resolve(await realpath(file)).toLowerCase()!==resolve(file).toLowerCase())throw Error('Installed browser runtime requires regular local files');}
 const modules=mcp.env?.NODE_REPL_NODE_MODULE_DIRS;if(typeof modules!=='string'||!inside(runtimeRoot,modules))throw Error('Unexpected installed browser modules');
 if(JSON.parse(await readFile(join(modules,'@oai/cua-repl/package.json'),'utf8')).name!=='@oai/cua-repl')throw Error('Installed browser package differs');
 const settings={command:mcp.command,args:mcp.args,enabled:true,enabled_tools:['js','js_reset'],startup_timeout_sec:120,'tools.js.approval_mode':'approve','tools.js_reset.approval_mode':'approve'};
 for(const [key,value]of Object.entries(mcp.env??{})){if(typeof value!=='string')throw Error('Unexpected browser environment');settings['env.'+key]=value;}
 settings['env.CUA_REPL_ENABLED_SURFACES']='browser';settings['env.BROWSER_USE_AVAILABLE_BACKENDS']='chrome';settings['env.NODE_REPL_TRUSTED_CODE_PATHS']=modules;
 return {schemaVersion:2,provider:'installed-ai-browser',settings,manifestSha256:createHash('sha256').update(raw).digest('hex')};
}
export function installedBrowserArguments(config){if(!config.settings||config.schemaVersion!==2)throw Error('Verify installed browser configuration before launch');return Object.entries(config.settings).flatMap(([key,value])=>['-c','mcp_servers.cua_repl.'+key+'='+JSON.stringify(value)]);}

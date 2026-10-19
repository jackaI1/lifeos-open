import {httpsOrigin} from '../shared/service-config.mjs';
import {readFile,readdir} from 'node:fs/promises';
import {join} from 'node:path';
import {AppError} from './store.mjs';
export async function releaseCatalogue(config){
 if(!config.maintenanceRoot)return {releases:[],current:{beta:null,production:null},status:'not-configured'};
 let state;try{state=JSON.parse(await readFile(join(config.maintenanceRoot,'state.json'),'utf8'));}catch(e){if(e.code==='ENOENT')return {releases:[],current:{beta:null,production:null},status:'initializing'};throw e;}
 const files=await readdir(join(config.maintenanceRoot,'releases')).catch(e=>{if(e.code==='ENOENT')return [];throw e;}),releases=[];
 for(const file of files.filter(name=>/^beta-[a-f0-9]{16}\.json$/.test(name))){const r=JSON.parse(await readFile(join(config.maintenanceRoot,'releases',file),'utf8'));const beta=state.history.some(h=>h.environment==='beta'&&h.releaseId===r.releaseId),production=state.history.some(h=>h.environment==='production'&&h.releaseId===r.releaseId);releases.push({releaseId:r.releaseId,commit:r.commit,summary:r.summary,createdAt:r.createdAt,risks:r.risks,status:r.status,tests:r.tests?.suite?.status,betaUrl:config.betaOrigin?httpsOrigin(config.betaOrigin):null,canDeployBeta:r.releaseId===state.betaRelease,canPromote:beta&&r.releaseId!==state.productionRelease,canRollback:production&&r.releaseId!==state.productionRelease});}
 return {releases:releases.sort((a,b)=>b.createdAt.localeCompare(a.createdAt)),current:{beta:state.betaRelease,production:state.productionRelease},status:'ready'};
}
export async function validateReleaseRequest(config,body){
 if(config.environment!=='production')throw new AppError('Release actions are available only in the production owner session',403);
 if(body.intentional!==true||!['promote','rollback','deploy-beta'].includes(body.action)||!/^beta-[a-f0-9]{16}$/.test(body.releaseId??''))throw new AppError('Review and confirm a specific release action');
 const catalogue=await releaseCatalogue(config),release=catalogue.releases.find(r=>r.releaseId===body.releaseId);
 if(!release)throw new AppError('Release not found',404);
 const key={promote:'canPromote',rollback:'canRollback','deploy-beta':'canDeployBeta'}[body.action];if(!release[key])throw new AppError('This release is not eligible for that action',409);
 const expected=body.action==='deploy-beta'?catalogue.current.beta:catalogue.current.production;if(body.expectedCurrentRelease!==expected)throw new AppError('The live release changed. Review the current release first.',409);
 return {intentional:true,action:body.action,releaseId:body.releaseId,expectedCurrentRelease:expected};
}

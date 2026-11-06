import {RunnableSequence} from '@langchain/core/runnables';
import {RetrievalIndex,savedSources,groundedAnswer,DEFAULT_THRESHOLD,SOURCE_KINDS} from './retrieval.mjs';
import {localEmbedder,MODEL_ID} from './retrieval-model.mjs';

/** Service-owned model and derived SQLite cache. Initialization never downloads weights. */
export class WorkspaceRetrieval{
 constructor(path,{threshold=DEFAULT_THRESHOLD,cacheDir='.cache/retrieval-model'}={}){
  if(!Number.isFinite(threshold)||threshold<=0||threshold>1)throw Error('RAG_THRESHOLD must be between 0 (exclusive) and 1.');
  this.path=path;this.threshold=threshold;this.cacheDir=cacheDir;
 }
 async answer(db,question,{courseId=undefined,generate=undefined}={}){
  try{
   this.loading??=localEmbedder({cacheDir:this.cacheDir});
   this.model=await this.loading;
   this.index??=new RetrievalIndex(this.path,{embed:this.model.embed,modelId:MODEL_ID});
   const rows=(await db.prepare('SELECT kind,id,data FROM records WHERE kind IN ('+SOURCE_KINDS.map(()=>'?').join(',')+') ORDER BY kind,id').bind(...SOURCE_KINDS).all()).results;
   await this.index.sync(savedSources(rows));
   const chain=RunnableSequence.from([
    async input=>({question:input,hits:await this.index.search(input,{k:3,threshold:this.threshold,courseId})}),
    async ({question:input,hits})=>groundedAnswer(input,hits,generate),
   ]);
   return {...await chain.invoke(question),model:MODEL_ID,threshold:this.threshold};
  }catch{
   // Never answer from stale vectors or fall back to an ungrounded provider call.
   if(!this.model)this.loading=undefined;
   return {text:"I don't know from the saved notes and calendar entries because local retrieval is unavailable. Run npm run rag:download, check the index path, then retry.",citations:[],abstained:true,mode:'unavailable',model:MODEL_ID,threshold:this.threshold};
  }
 }
 async close(){this.index?.close();if(this.loading)await this.loading.catch(()=>{});await this.model?.close();}
}

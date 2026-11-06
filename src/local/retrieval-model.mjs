import {resolve} from 'node:path';
// Fixed weights keep the cached vectors and the evaluation in the same embedding space.
export const MODEL='Xenova/all-MiniLM-L6-v2';
export const REVISION='751bff37182d3f1213fa05d7196b954e230abad9';
export const MODEL_ID=MODEL+'@'+REVISION+':q8:mean:normalized:480/80:v1';

export async function localEmbedder({download=false,cacheDir='.cache/retrieval-model'}={}){
 const {pipeline,env}=await import('@huggingface/transformers');
 // Registry discovery in Transformers.js 4 probes metadata before applying pipeline
 // local_files_only. Load the pinned directory directly and disable remote reads.
 env.allowRemoteModels=download;
 const modelPath=download?MODEL:resolve(cacheDir,MODEL,REVISION);
 const extractor=await pipeline('feature-extraction',modelPath,{
  revision:REVISION,dtype:'q8',device:'cpu',cache_dir:cacheDir,local_files_only:!download,
  session_options:{intraOpNumThreads:2,interOpNumThreads:1},
 });
 return {
  modelId:MODEL_ID,
  async embed(texts){
   if(!texts.length)return [];
   const output=await extractor(texts,{pooling:'mean',normalize:true});
   return output.tolist();
  },
  async close(){await extractor.dispose();},
 };
}

import {localEmbedder,MODEL_ID} from '../src/local/retrieval-model.mjs';
const model=await localEmbedder({download:true});
try{console.log('Downloaded local embedding model: '+MODEL_ID);}
finally{await model.close();}

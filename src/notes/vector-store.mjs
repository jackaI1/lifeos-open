import {DatabaseSync} from 'node:sqlite';
import {mkdirSync, chmodSync} from 'node:fs';
import {dirname} from 'node:path';
import {VectorStore} from '@langchain/core/vectorstores';
import {Document} from '@langchain/core/documents';

function validateVector(vector, dimensions){
 if(!Array.isArray(vector)||!vector.length||vector.some(v=>!Number.isFinite(v))||!vector.some(v=>v!==0)||(dimensions&&vector.length!==dimensions))throw Error('Invalid embedding or changed dimensions. Rebuild the notes index.');
}
/** Small local corpora: SQLite persists vectors; exact cosine search avoids a native extension. */
export class NoteVectorStore extends VectorStore {
 constructor(embeddings,{path}){
  super(embeddings,{path});
  if(path!==':memory:')mkdirSync(dirname(path),{recursive:true,mode:0o700});
  this.db=new DatabaseSync(path);this.db.exec('PRAGMA busy_timeout=5000; CREATE TABLE IF NOT EXISTS chunks (text TEXT NOT NULL, metadata TEXT NOT NULL, vector TEXT NOT NULL); CREATE TABLE IF NOT EXISTS state (key TEXT PRIMARY KEY, value TEXT NOT NULL)');
  if(path!==':memory:')chmodSync(path,0o600);
 }
 _vectorstoreType(){return 'lifeos-sqlite';}
 async addDocuments(documents){return this.addVectors(await this.embeddings.embedDocuments(documents.map(d=>d.pageContent)),documents);}
 async addVectors(vectors,documents){
  if(vectors.length!==documents.length)throw Error('Embedding count does not match notes.');
  for(const v of vectors)validateVector(v,vectors[0]?.length);
  const insert=this.db.prepare('INSERT INTO chunks VALUES(?,?,?)');
  for(let i=0;i<documents.length;i++)insert.run(documents[i].pageContent,JSON.stringify(documents[i].metadata),JSON.stringify(vectors[i]));
 }
 async replace(documents,fingerprint){
  // Resolve the model call before changing the index, so a failed refresh preserves the old snapshot.
  const vectors=documents.length?await this.embeddings.embedDocuments(documents.map(d=>d.pageContent)):[];
  this.db.exec('BEGIN IMMEDIATE');
  try{this.db.exec('DELETE FROM chunks');await this.addVectors(vectors,documents);this.db.prepare("INSERT OR REPLACE INTO state VALUES('fingerprint',?)").run(fingerprint);this.db.exec('COMMIT');}catch(error){this.db.exec('ROLLBACK');throw error;}
 }
 fingerprint(){return this.db.prepare("SELECT value FROM state WHERE key='fingerprint'").get()?.value;}
 count(){return this.db.prepare('SELECT COUNT(*) AS count FROM chunks').get().count;}
 async similaritySearchVectorWithScore(query,k){
  validateVector(query);
  const norm=Math.hypot(...query);
  return this.db.prepare('SELECT * FROM chunks').all().map(row=>{
   const vector=JSON.parse(row.vector);validateVector(vector,query.length);
   const score=vector.reduce((sum,v,i)=>sum+v*query[i],0)/(Math.hypot(...vector)*norm);
   return [new Document({pageContent:row.text,metadata:JSON.parse(row.metadata)}),score];
  }).sort((a,b)=>b[1]-a[1]).slice(0,k);
 }
 close(){this.db.close();}
}

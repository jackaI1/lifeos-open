import {createHash} from 'node:crypto';
import {lifeosDay} from '../../public/lifeos-day.js';
export const normalizeJournalText=value=>String(value).normalize('NFKC').replace(/[\u200b-\u200f\ufeff]/g,'').replace(/\s+/g,' ').trim();
export function revisionPlainText(snapshot){
 const inserts=(snapshot?.chunkedSnapshot??[]).flat().filter(x=>x.ty==='is').sort((a,b)=>a.ibi-b.ibi);if(!inserts.length)throw Error('Revision contains no text');let end=inserts[0].ibi;
 for(const part of inserts){if(part.ibi!==end||typeof part.s!=='string')throw Error('Revision text is not contiguous');end+=part.s.length;}
 return inserts.map(x=>x.s).join('');
}
// Match all seven answers in order within one bounded source span. No models or inferred writing dates.
export function sevenArrowSpan(points,text,{normalized=false}={}){
 if(points?.length!==7||points.some(p=>!p?.trim()))return null;
 const answers=points.map(normalizeJournalText),source=normalized?text:normalizeJournalText(text),budget=answers.reduce((n,p)=>n+p.length,0)+4000;
 let start=source.indexOf(answers[0]),tries=0;
 while(start>=0&&tries++<100){let cursor=start,valid=true;for(const answer of answers){const at=source.indexOf(answer,cursor);if(at<0||at+answer.length>start+budget){valid=false;break;}cursor=at+answer.length;}if(valid)return {start,end:cursor};start=source.indexOf(answers[0],start+1);}
 return null;
}
export function journalUpdateEvidence(entries,versions){
 const ordered=versions.filter(v=>Number.isFinite(Date.parse(v.at))).toSorted((a,b)=>Date.parse(a.at)-Date.parse(b.at)),result={};
 for(const version of ordered){const text=version.text??revisionPlainText(version.snapshot),normalized=normalizeJournalText(text),snapshotHash=createHash('sha256').update(text).digest('hex');for(const entry of entries){if(result[entry.id])continue;const span=sevenArrowSpan(entry.points,normalized,{normalized:true});if(!span)continue;result[entry.id]={sourceUpdateDay:lifeosDay(version.at),sourceUpdatedAt:version.at,revision:String(version.revision),sourceSpan:span,snapshotHash,basis:version===ordered[0]?'earliest-retained-document-version':'seven-arrows-present-in-document-version'};}}
 return result;
}

import {AppError} from '../shared/errors.mjs';
export const aiWorkerTypes=Object.freeze(['assignment-brief','lecture-study','assistant','support','inspire','coop-draft']);
export const ownerAIPairs=Object.freeze([
 ['assistant','owner-assistant-request'],['lecture-study','owner-lecture-study'],['assignment-brief','owner-assignment-brief'],['support','owner'],['inspire','owner']
].map(Object.freeze));
// Values stay bound parameters; a permitted type does not grant another type's authority.
export function jobPairPredicate(pairs){
 if(!Array.isArray(pairs)||!pairs.length||pairs.length>20||pairs.some(pair=>!Array.isArray(pair)||pair.length!==2||pair.some(value=>typeof value!=='string'||!value||value.length>100)))throw new AppError('Valid worker job authority pairs required');
 return{sql:'('+pairs.map(()=>'(type=? AND authority=?)').join(' OR ')+')',args:pairs.flat()};
}

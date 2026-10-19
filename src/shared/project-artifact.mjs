import * as v from '../server/validation.mjs';
import {AppError} from './errors.mjs';

export const projectArtifactSchema={type:'object',description:'One useful piece of prepared work for the selected captured project: an outline, draft, comparison or checklist. Include a small next action and explicit assumptions. Generated content is a draft to review; never execute code or claim a completed action.',additionalProperties:false,properties:{kind:{type:'string',enum:['outline','draft','comparison','checklist']},title:{type:'string',maxLength:180},body:{type:'string',maxLength:12000},nextAction:{type:'string',maxLength:500},assumptions:{type:'array',maxItems:6,items:{type:'string',maxLength:400}}},required:['kind','title','body','nextAction','assumptions']};
export const projectReplySchema={type:'object',additionalProperties:false,properties:{reply:{type:'string'},needsInput:{type:'boolean',description:'If one missing fact prevents useful work, ask for that fact in reply, set needsInput true and artifact null. Otherwise provide one useful artifact.'},proposals:{type:'array',maxItems:0,items:{type:'string'}},artifact:{description:'Prepared work to review, or null when a missing fact prevents useful work. This is preparation only; never execute generated code or claim a completed action.',anyOf:[projectArtifactSchema,{type:'null'}]}},required:['reply','needsInput','proposals','artifact']};
export function validateProjectArtifact(artifact){
 v.exactFields(artifact,['kind','title','body','nextAction','assumptions']);v.enumValue(artifact.kind,projectArtifactSchema.properties.kind.enum);v.text(artifact.title,180,{required:true});v.text(artifact.body,12000,{required:true});v.text(artifact.nextAction,500,{required:true});
 if(!Array.isArray(artifact.assumptions)||artifact.assumptions.length>6)throw new AppError('Too many preparation assumptions');for(const text of artifact.assumptions)v.text(text,400,{required:true});
 return structuredClone(artifact);
}

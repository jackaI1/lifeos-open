import {PDFDocument,PDFName,PDFDict,PDFTextField,PDFCheckBox,StandardFonts,rgb} from 'pdf-lib';
import type {PoolClient} from 'pg';
export const rules:Record<string,{draft:boolean;path?:string;reason:string}>={
 'patient.name':{draft:true,path:'/demographics/name',reason:'Copy the fictional chart identity'},
 'patient.birthDate':{draft:true,path:'/demographics/birthDate',reason:'Copy the explicit birth date'},
 'history.allergies':{draft:true,path:'/history/allergies',reason:'Copy the recorded history without interpreting it'},
 'history.hasAllergies':{draft:true,path:'/history/hasAllergies',reason:'Copy the explicit boolean only'},
 'visit.reason':{draft:true,path:'/visit/reason',reason:'Copy the stated reason for the visit'},
 'physician.diagnosis':{draft:false,reason:'Clinical judgment belongs to the physician'},
 'physician.signature':{draft:false,reason:'Only the physician may sign'}
};
export async function sampleForm(){
 const pdf=await PDFDocument.create(),page=pdf.addPage([612,792]),font=await pdf.embedFont(StandardFonts.Helvetica),form=pdf.getForm();
 page.drawRectangle({x:36,y:688,width:540,height:68,color:rgb(.12,.25,.22)});
 page.drawText('Fictional chart review',{x:52,y:722,size:22,font,color:rgb(1,1,1)});
 page.drawText('Learning sample only. Not a clinical document.',{x:52,y:700,size:11,font,color:rgb(1,1,1)});
 const labels=['Patient name','Birth date (YYYY-MM-DD)','Allergies as recorded','Allergies recorded?','Reason for visit','Physician diagnosis (leave blank)','Physician signature (leave blank)'];
 for(const [i,name]of Object.keys(rules).entries()){
  const y=640-i*76;page.drawText(labels[i],{x:50,y:y+26,size:11,font});
  if(name==='history.hasAllergies'){form.createCheckBox(name).addToPage(page,{x:50,y,width:18,height:18});}
  else if(name==='physician.signature'){
   page.drawRectangle({x:50,y,width:512,height:22,borderWidth:1,borderColor:rgb(.5,.6,.55)});
   const signature=form.createTextField(name),field=signature.acroField.dict,ref=signature.ref;field.set(PDFName.of('FT'),PDFName.of('Sig'));
   const widget=pdf.context.obj({Type:'Annot',Subtype:'Widget',Rect:[50,y,562,y+22],Parent:ref,P:page.ref,F:4});const wr=pdf.context.register(widget);field.set(PDFName.of('Kids'),pdf.context.obj([wr]));page.node.addAnnot(wr);
  } else{const f=form.createTextField(name);f.setMaxLength(name==='visit.reason'?90:70);f.addToPage(page,{x:50,y,width:512,height:22,font,borderWidth:1,borderColor:rgb(.5,.6,.55)});f.setFontSize(11);}
 }
 page.drawText('Drafts copy source facts only. Diagnosis and signature require physician review.',{x:50,y:74,size:10,font});
 form.updateFieldAppearances(font);return pdf.save();
}
export async function inspectForm(bytes:Uint8Array){
 const pdf=await PDFDocument.load(bytes),form=pdf.getForm(),fields=form.getFields(),names=new Set<string>(),widgetDicts=new Set<PDFDict>();
 const map=fields.map(field=>{
  const name=field.getName();if(names.has(name)||!rules[name])throw Error('Unknown or duplicate form field: '+name);names.add(name);
  const widgets=field.acroField.getWidgets();for(const w of widgets){
   widgetDicts.add(w.dict);
   const own=w.dict.get(PDFName.of('V')),canonical=field.acroField.getInheritableAttribute(PDFName.of('V'));
   if(own&&own.toString()!==canonical?.toString())throw Error('Widget value disagrees with canonical field: '+name);
  }
  const hasAppearance=(w:any)=>{
   const ap=w.dict.lookupMaybe(PDFName.of('AP'),PDFDict),normal=ap&&pdf.context.lookup(ap.get(PDFName.of('N')));
   if(!normal)return false;
   const nonempty=(value:any)=>typeof value?.getContents==='function'&&value.getContents().length>0;
   return normal instanceof PDFDict?normal.keys().length>0&&normal.keys().every(key=>nonempty(pdf.context.lookup(normal.get(key)))):nonempty(normal);
  };
  const value=field instanceof PDFTextField?field.getText()??'':field instanceof PDFCheckBox?field.isChecked():field.acroField.dict.get(PDFName.of('V'))?.toString()??'';
  if(!rules[name].draft&&value)throw Error('Physician-only field must be blank: '+name);
  return {name,type:field.acroField.getInheritableAttribute(PDFName.of('FT'))?.toString(),fieldRef:field.ref.toString(),widgets:widgets.map(w=>({rect:w.getRectangle(),appearance:hasAppearance(w)})),rule:rules[name],value};
 });
 let count=0;for(const page of pdf.getPages()){const annots=page.node.Annots();if(annots)for(const ref of annots.asArray()){const annotation=pdf.context.lookup(ref,PDFDict);if(annotation.get(PDFName.of('Subtype'))?.toString()==='/Widget'){count++;if(!widgetDicts.has(annotation))throw Error('Orphan or ambiguous widget annotation');}}}
 if(count!==widgetDicts.size||names.size!==Object.keys(rules).length)throw Error('Incomplete canonical field tree or widgets');
 return map;
}
export async function draftForm(bytes:Uint8Array,chart:any){
 if(chart.fictional!==true)throw Error('Only fictional charts are accepted by this sample tool');
 await inspectForm(bytes);const pdf=await PDFDocument.load(bytes),form=pdf.getForm(),citations=[];
 for(const field of form.getFields()){
  const name=field.getName(),rule=rules[name];if(!rule.draft)continue;
  const value=rule.path!.split('/').slice(1).reduce((o,k)=>o?.[k],chart);
  if(field instanceof PDFTextField){if(typeof value!=='string'||value.length>field.getMaxLength()!)throw Error('Missing or oversized source text');field.setText(value);}
  else if(field instanceof PDFCheckBox){if(typeof value!=='boolean')throw Error('Missing source boolean');if(value)field.check();else field.uncheck();}
  else throw Error('Unsupported draft field type');
  citations.push({field:name,value,source:'chart.json#'+rule.path});
 }
 form.updateFieldAppearances(await pdf.embedFont(StandardFonts.Helvetica));
 const output=await pdf.save();const map=await inspectForm(output);
 if(map.some(f=>f.rule.draft&&f.widgets.some(w=>!w.appearance)))throw Error('Missing appearance stream');
 return {output,map,citations};
}
export async function storeMappings(client:PoolClient,documentId:string,map:any[],citations:any[]){
 await client.query('BEGIN');try{
  await client.query('CREATE TABLE IF NOT EXISTS form_maps(document_id TEXT NOT NULL,field_name TEXT NOT NULL,field_type TEXT NOT NULL,draft_allowed BOOLEAN NOT NULL,rule TEXT NOT NULL,source TEXT,value JSONB,PRIMARY KEY(document_id,field_name),CHECK(draft_allowed OR (value IS NULL AND source IS NULL)))');
  for(const f of map){const citation=citations.find(c=>c.field===f.name);if(!f.rule.draft&&citation)throw Error('Physician field cannot have a draft');await client.query('INSERT INTO form_maps VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(document_id,field_name) DO UPDATE SET field_type=excluded.field_type,draft_allowed=excluded.draft_allowed,rule=excluded.rule,source=excluded.source,value=excluded.value',[documentId,f.name,f.type,f.rule.draft,f.rule.reason,citation?.source??null,citation?JSON.stringify(citation.value):null]);}
  await client.query('COMMIT');
 }catch(e){await client.query('ROLLBACK');throw e;}
}

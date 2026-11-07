import test from'node:test';import assert from'node:assert/strict';import{readFile}from'node:fs/promises';import{PDFDocument,PDFName,PDFString}from'pdf-lib';import{sampleForm,draftForm,inspectForm,storeMappings}from'../tools/forms/form.ts';import{Pool}from'pg';
const chart=JSON.parse(await readFile('samples/forms/chart.json','utf8'));
test('AcroForm tree and widget types agree; only cited fields are drafted',async()=>{
 const blank=await sampleForm(),draft=await draftForm(blank,chart);assert.equal(draft.map.length,7);assert.equal(draft.citations.length,5);assert.equal(draft.map.find(f=>f.name==='physician.signature').type,'/Sig');
 for(const f of draft.map){if(!f.rule.draft)assert.equal(f.value,'');else{assert.ok(f.widgets.every(w=>w.appearance));assert.ok(draft.citations.some(c=>c.field===f.name&&c.source.startsWith('chart.json#/')));}}
 assert.equal(draft.map.find(f=>f.name==='patient.name').value,'Alex Example');
});
test('physician-only input and unknown fields are rejected, never carried into output',async()=>{
 const blank=await sampleForm(),pdf=await PDFDocument.load(blank);pdf.getForm().getTextField('physician.diagnosis').setText('Must never pass');await assert.rejects(draftForm(await pdf.save(),chart),/Physician-only/);
 const unknown=await PDFDocument.load(blank);unknown.getForm().createTextField('unexpected');await assert.rejects(inspectForm(await unknown.save()),/Unknown/);await assert.rejects(draftForm(blank,{fictional:false}),/fictional/);
});
test('committed filled sample is a logical regression snapshot with appearances',async()=>{
 const map=await inspectForm(await readFile('samples/forms/filled.pdf')),expected=await draftForm(await sampleForm(),chart);assert.deepEqual(map.map(({name,type,value})=>({name,type,value})),expected.map.map(({name,type,value})=>({name,type,value})));
});
test('PostgreSQL stores citations and rejects physician values at the constraint',{skip:!process.env.FORM_DATABASE_URL},async()=>{
 const pool=new Pool({connectionString:process.env.FORM_DATABASE_URL}),client=await pool.connect();try{const draft=await draftForm(await sampleForm(),chart);await storeMappings(client,'test-form',draft.map,draft.citations);const rows=await client.query("SELECT * FROM form_maps WHERE document_id='test-form'");assert.equal(rows.rowCount,7);assert.equal(rows.rows.filter(r=>r.source).length,5);await assert.rejects(client.query("UPDATE form_maps SET value='\"forbidden\"' WHERE document_id='test-form' AND NOT draft_allowed"),/check constraint/);}finally{client.release();await pool.end();}
});

test('stale widget values are rejected even when a page could render them',async()=>{
 const pdf=await PDFDocument.load(await sampleForm()),field=pdf.getForm().getTextField('patient.name');field.setText('Canonical');field.acroField.getWidgets()[0].dict.set(PDFName.of('V'),PDFString.of('Stale'));await assert.rejects(inspectForm(await pdf.save()),/Widget value disagrees/);
});

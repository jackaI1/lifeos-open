import {readFile,writeFile} from 'node:fs/promises';
import {Pool} from 'pg';
import {sampleForm,draftForm,storeMappings} from './form.ts';
const bytes=await sampleForm(),chart=JSON.parse(await readFile('samples/forms/chart.json','utf8')),draft=await draftForm(bytes,chart);
await writeFile('samples/forms/blank.pdf',bytes);await writeFile('samples/forms/filled.pdf',draft.output);await writeFile('samples/forms/field-map.json',JSON.stringify({fields:draft.map,citations:draft.citations},null,2)+'\n');
if(process.env.FORM_DATABASE_URL){const pool=new Pool({connectionString:process.env.FORM_DATABASE_URL}),client=await pool.connect();try{await storeMappings(client,'fictional-medical-form',draft.map,draft.citations);}finally{client.release();await pool.end();}}
console.log('Wrote seven mapped fields, five source citations; physician fields remain blank.');

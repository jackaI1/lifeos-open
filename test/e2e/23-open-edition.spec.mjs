import {assert,button,visible,go,reload} from './helpers.mjs';
export default async function({page:p}){
 await go(p,'school?view=courses');await button(p,'New course').click();await p.getByLabel('Course title',{exact:true}).fill('Example manual course');await p.getByLabel('Course code',{exact:true}).fill('DEMO');await button(p,'Save course').click();await visible(p,'Example manual course');
 await button(p,'New task').click();await p.getByLabel('Task title',{exact:true}).fill('Example manual task');await p.getByLabel('Course',{exact:true}).selectOption({label:'Example manual course'});await button(p,'Save task').click();await p.locator('#dialog').waitFor({state:'hidden'});await reload(p);
 const b=await p.evaluate(async()=>await(await fetch('/api/bootstrap')).json());assert.ok(b.records.task.some(r=>r.data.title==='Example manual task'));assert.equal(await button(p,'Refresh school sources').count(),0);
 await go(p,'prayer');await p.getByRole('button',{name:/Record/}).first().click();await button(p,'Pause').waitFor();await p.waitForTimeout(1200);await p.getByRole('button',{name:/Stop/}).click();await visible(p,'Recording saved');
 const sessions=await p.evaluate(async()=>await(await fetch('/api/records/prayer-session?limit=100')).json());const record=sessions.items.find(r=>r.data.uploadStatus==='stored');assert.ok(record);assert.equal(record.data.processingStatus,'stored');
 const jobs=await p.evaluate(async()=>await(await fetch('/api/jobs')).json());assert.ok(!jobs.jobs.some(j=>j.type.includes('prayer')));
 await go(p,'prayer?view=journal');await p.locator('audio').waitFor();assert.equal(await button(p,'By request').count(),0);
 await go(p,'friends?entry=demo-maya');assert.equal(await button(p,'Add from messages').count(),0);
}

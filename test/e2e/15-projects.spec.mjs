import {assert,button,visible,go,reload,saveNote,lecture,draw,ask} from './helpers.mjs';
export default async function({page:p,configured}){
await go(p,'tickets');await button(p,'Add project').click();await p.getByLabel('Project name',{exact:true}).fill('Synthetic rain garden');await p.getByLabel('Next action',{exact:true}).fill('Sketch the water path');await button(p,'Save changes').click();await button(p,'Add step').click();await p.getByLabel('Step title').fill('Measure planter');await button(p,'Save step').click();await button(p,'Add time block').click();await p.getByLabel('Minutes',{exact:true}).fill('25');await button(p,'Save time block').click();
// The preceding time-block save can still be in flight. Await this checkbox's
// mutation, rather than treating any project PUT as confirmation of its save.
const savedStep=p.waitForResponse(r=>r.url().includes('/api/records/project/')&&r.request().method()==='PUT'&&r.request().postDataJSON()?.data?.steps?.some(step=>step.title==='Measure planter'&&step.done===true));
await p.getByRole('checkbox',{name:'Measure planter'}).check();const response=await savedStep;assert.ok(response.ok(),'Project step save failed');const persisted=await response.json();assert.ok(persisted.item.data.steps.some(step=>step.title==='Measure planter'&&step.done===true),'Server did not persist the checked step');await reload(p);await visible(p,'Synthetic rain garden');assert.ok(await p.getByRole('checkbox',{name:'Measure planter'}).isChecked());await visible(p,'25 min');await p.locator('.project-plan').scrollIntoViewIfNeeded();
}

import {assert,go} from './helpers.mjs';

export default async function({page}){
 await page.route('**/api/bootstrap',async route=>{
  const response=await route.fetch(),body=await response.json();
  body.today.timeline.push({id:'synthetic-untimed-obligation',title:'Synthetic untimed obligation',kind:'task',state:'planned',start:'invalid-start',end:null,target:{route:'school'}});
  await route.fulfill({response,json:body});
 });
 await go(page,'today');
 const row=page.locator('.story-item').filter({hasText:'Synthetic untimed obligation'});
 await row.waitFor();assert.equal(await row.count(),1,'an unknown source time must not hide the schedule');
 assert.equal((await row.locator('.schedule-clock').innerText()).trim(),'','an unknown start must not become an invented clock');
}

import {assert,button,visible,go} from './helpers.mjs';
import {writeFile,mkdir} from 'node:fs/promises';
// Exact owner-approved source/repository links only; this audit never fetches them.
const allowedExternalLinks=new Set([
 'https://hansons-running.com/content/training-plans','https://operationworld.org/',
 'https://github.com/example/lifeos-open','https://github.com/example/community-garden-planner',
 'https://github.com/example/library-catalogue','https://github.com/example/habit-tracker',
 'https://github.com/example/reading-queue',
 'https://github.com/example/weather-dashboard','https://github.com/example/sketchbook'
]);
export default async function({page:p}){
 if(process.env.E2E_AUDIT_CONTROLS)p.on('dialog',async dialog=>{if(dialog.type()==='beforeunload')await dialog.accept();else await dialog.dismiss();});
 async function scan(route){const text=await p.locator('body').innerText();assert.doesNotMatch(text,/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}|\b(?:undefined|null|NaN)\b|\[object|codex|gpt-|astra|[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}/i,'Visible text on '+route);const links=await p.locator('#main a[href^=http]:visible').evaluateAll(es=>es.map(e=>e.href));assert.deepEqual(links.filter(url=>new URL(url).origin!==p.origin&&!allowedExternalLinks.has(url)),[],'Unconfigured external links on '+route);}
 const routes=['today','devotional','prayer','school','tickets','exercise','reminders','email','finances','notes','friends','journal','photos','support','settings','settings?section=deleted','school?view=courses','school?view=work','school?view=coop','school?learning=demo-course-design','journal?view=templates','prayer?view=journal','reminders?view=cooking'];const inventory=[];
 for(const route of routes){await go(p,route);await p.locator('#main h1').waitFor();assert.ok(!/This page could not open|Your workspace is unavailable|Invalid record identifier|temporarily unavailable|is not iterable|Cannot read properties/.test(await p.locator('#main').innerText()),'Broken destination '+route);await scan(route);const fit=await p.evaluate(()=>({width:innerWidth,scroll:document.documentElement.scrollWidth}));assert.ok(fit.scroll<=fit.width+2,'Overflow on '+route+JSON.stringify(fit));
  const controls=await p.locator('#main button:enabled,#main input:not([type=hidden]),#main select,#main textarea,#main summary,#main a').evaluateAll(es=>es.map(e=>({tag:e.tagName,label:e.getAttribute('aria-label')??e.innerText??e.getAttribute('placeholder'),href:e.getAttribute('href'),visible:!!e.getClientRects().length})));inventory.push({route,controls});
  if(process.env.E2E_AUDIT_CONTROLS){
   const offered=[];for(const control of await p.locator('#main').getByRole('button').all()){if(!await control.isVisible()||!await control.isEnabled())continue;const match=(await control.ariaSnapshot()).match(/^- button \"((?:[^\"\\]|\\.)*)\"/);if(match)offered.push(JSON.parse('"'+match[1]+'"'));}const names=[...new Set(offered)],actions=[];let visit=0;
   for(const name of names){await p.goto(p.origin+'/?audit='+encodeURIComponent(route)+'-'+(++visit)+'#'+route,{waitUntil:'networkidle'});const control=p.locator('#main').getByRole('button',{name:name.startsWith('Timers and time history')?/^Timers and time history/:name,exact:!name.startsWith('Timers and time history')}).filter({visible:true}).first();
    if(!await control.count()){actions.push({name,result:'State changed after an earlier primary action'});continue;}if(!await control.isEnabled()){actions.push({name,result:'Disabled by current state'});continue;}
    if(/Send/.test(name)){const input=p.locator('#main textarea:visible').last();if(await input.count()&&await input.isEditable())await input.fill('Synthetic interface audit: how do I use this page?');}
    await control.click();await p.waitForTimeout(150);actions.push({name,result:'Clicked',destination:p.url().split('#')[1]});for(const popup of p.context().pages().filter(tab=>tab!==p))await popup.close();await p.keyboard.press('Escape');if(await p.locator('#dialog').isVisible())await p.locator('#dialog').getByRole('button',{name:'Close',exact:true}).click();
   }inventory.at(-1).actions=actions;await go(p,route);
  }
  // Exercise every disclosure and tab on the destination, including their close path.
  const summaries=p.locator('#main details > summary');for(let i=0;i<await summaries.count();i++){const summary=summaries.nth(i);if(await summary.isVisible()){await summary.click();await p.waitForTimeout(70);await scan(route+' disclosure '+await summary.innerText());await summary.click();}}
  const tabs=p.locator('#main [role=tab]');for(let i=0;i<await tabs.count();i++){await tabs.nth(i).click();await p.waitForTimeout(80);}
  await p.screenshot({path:(process.env.PARITY_DIR??'.runtime/e2e')+'/navigation-'+route.replace(/[^a-z]/gi,'-')+'-'+p.viewportSize().width+'.png'});
 }
 // Off-happy paths: empty library searches and invalid local form inputs.
 await go(p,'notes');await p.getByLabel('Search notes').fill('synthetic-no-match-349');await visible(p,'Create your first note');await p.getByLabel('Search notes').fill('Systems');await visible(p,'Systems vocabulary');await go(p,'today');await button(p,'Add event').click();await button(p,'Save event').click();assert.ok(await p.getByLabel('Event title',{exact:true}).evaluate(e=>!e.validity.valid));await p.locator('#dialog').getByRole('button',{name:'Close',exact:true}).click();
 const dir=process.env.PARITY_DIR??'.runtime/e2e';await mkdir(dir,{recursive:true});await writeFile(dir+'/control-inventory-'+(process.env.E2E_RUN??'latest')+'-'+p.viewportSize().width+'.json',JSON.stringify(inventory,null,2));
}

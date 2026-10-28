import {assert,button,go,reload} from './helpers.mjs';
export default async function({page:p}){
 await go(p,'devotional');
 await button(p,'Start devotional timer').waitFor({timeout:5000});
 assert.equal(await p.getByRole('switch',{name:'I have completed my devotional'}).count(),1);
 await button(p,'Start devotional timer').click();await button(p,'Pause devotional timer').waitFor();
 await button(p,'Pause devotional timer').click();await button(p,'Resume devotional timer').waitFor();
 await reload(p);await button(p,'Resume devotional timer').waitFor();
 await button(p,'Save now').click();await button(p,'Start devotional timer').waitFor();
 await go(p,'settings');
 const phone=p.viewportSize().width<600;
 const section=async name=>{if(!phone)return button(p,name).click();const summary=p.locator('.settings-section summary').filter({hasText:name});if(!await summary.evaluate(n=>n.parentNode.open))await summary.click();};
 await section('Your day');
 await p.getByLabel('Wake time',{exact:true}).fill('07:25');
 await section('Theme');
 await p.getByRole('radio',{name:'Desk',exact:true}).click();
 await p.waitForFunction(()=>document.querySelector('.theme-grid').getAttribute('aria-busy')==='false');
 assert.equal(await p.evaluate(()=>document.documentElement.dataset.theme),'desk');
 if(!phone)await button(p,'Your day').click();
 assert.equal(await p.getByLabel('Wake time',{exact:true}).inputValue(),'07:25');
 await button(p,'Save preferences').click();await reload(p);
 assert.equal(await p.evaluate(()=>document.documentElement.dataset.theme),'desk');
 await section('Your day');
 assert.equal(await p.getByLabel('Wake time',{exact:true}).inputValue(),'07:25');
 await go(p,'today');await button(p,'Next schedule item').click();
 assert.equal(await p.locator('.story-selected').count(),1);
 await button(p,'Back to now').click();assert.equal(await p.locator('.story-selected').count(),0);
}

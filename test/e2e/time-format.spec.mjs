import {assert,go,reload} from './helpers.mjs';
export default async function({page:p}){
 await go(p,'today');
 const initial=await p.locator('.display-clock').innerText();assert.match(initial,/^\d{2}:\d{2}$/);
 const canonical=await p.evaluate(async()=>{const r=await fetch('/api/records/settings/preferences');return (await r.json()).item.data.wakeTime;});
 await go(p,'settings');const group=p.getByRole('radiogroup',{name:'Time format',exact:true});
 await group.getByRole('radio',{name:'12-hour (1:30 PM)',exact:true}).click();
 await p.waitForFunction(()=>document.querySelector('.time-format-options')?.getAttribute('aria-busy')==='false');
 assert.equal(await p.locator('html').getAttribute('data-time-format'),'12h');
 assert.match(await p.locator('.settings-summary').filter({hasText:'Wake'}).textContent(),/Wake 6:30 AM, Bedtime 10:00 PM/);
 await reload(p);assert.equal(await p.locator('html').getAttribute('data-time-format'),'12h');
 assert.equal(await group.getByRole('radio',{name:'12-hour (1:30 PM)',exact:true}).getAttribute('aria-checked'),'true');
 await go(p,'today');assert.match(await p.locator('.display-clock').innerText(),/^\d{1,2}:\d{2} [AP]M$/);
 const clocks=p.locator('.schedule-clock time');assert.ok(await clocks.count());for(const value of await clocks.allTextContents())assert.match(value,/^\d{1,2}:\d{2} [AP]M$/);
 const geometry=await p.evaluate(()=>[...document.querySelectorAll('.schedule-clock time,.display-clock')].map(n=>{const r=n.getBoundingClientRect(),parent=n.closest('.schedule-clock,.instrument-display').getBoundingClientRect();return{text:n.textContent,inside:r.left>=parent.left-1&&r.right<=parent.right+1,scroll:n.scrollWidth<=n.clientWidth+1};}));
 assert.ok(geometry.every(g=>g.inside&&g.scroll),'Full period label must fit '+JSON.stringify(geometry));
 await p.getByRole('button',{name:'Edit',exact:true}).click();const input=p.locator('input[type=time]').first();assert.match(await input.inputValue(),/^\d{2}:\d{2}$/);await p.getByRole('button',{name:'Done',exact:true}).click();
 await go(p,'settings');await p.getByText('Your day',{exact:true}).click();assert.equal(await p.getByLabel('Wake time',{exact:true}).inputValue(),canonical??'06:30');
 if(!await group.isVisible()){if(p.viewportSize().width>=1200)await p.getByRole('button',{name:'Theme',exact:true}).click();else await p.getByText('Theme',{exact:true}).first().click();}await group.getByRole('radio',{name:'12-hour (1:30 PM)',exact:true}).focus();await p.keyboard.press('ArrowLeft');await p.waitForFunction(()=>document.querySelector('.time-format-options')?.getAttribute('aria-busy')==='false');
 await reload(p);assert.equal(await p.locator('html').getAttribute('data-time-format'),'24h');await go(p,'today');assert.match(await p.locator('.display-clock').innerText(),/^\d{2}:\d{2}$/);
}

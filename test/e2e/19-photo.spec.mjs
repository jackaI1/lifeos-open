import {assert,button,visible,go,reload} from './helpers.mjs';
import {readFile} from 'node:fs/promises';
export default async function({page:p}){
 const landscape={name:'replacement.jpg',mimeType:'image/jpeg',buffer:await readFile('public/demo-landscape.jpg')};
 await go(p,'photos');await p.getByLabel('Choose a daily photo').setInputFiles({name:'synthetic.png',mimeType:'image/png',buffer:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aD1sAAAAASUVORK5CYII=','base64')});await p.getByLabel('Caption',{exact:true}).fill('Synthetic cyan landscape');
 // Delay delivery of one real API response (no fabricated response or UI stub).
 // Replacing during that save must retain the newer image even with unchanged caption.
 let release,received,first=true;const gate=new Promise(r=>release=r),ready=new Promise(r=>received=r);
 const delay=async route=>{if(first&&route.request().method()==='PUT'){first=false;const response=await route.fetch();received();await gate;await route.fulfill({response});}else await route.continue();};
 await p.route('**/api/daily-photos/*',delay);
 try{await button(p,'Save').click();await ready;await p.getByLabel('Replace daily photo').setInputFiles(landscape);await p.waitForFunction(()=>document.querySelector('.daily-photo-preview')?.naturalWidth===640);release();await button(p,'Saved to cloud').waitFor();}finally{release();await p.unroute('**/api/daily-photos/*',delay);}
 await reload(p);assert.equal(await p.getByLabel('Caption',{exact:true}).inputValue(),'Synthetic cyan landscape');assert.ok(await p.locator('.daily-photo-preview').evaluate(i=>i.complete&&i.naturalWidth===640));
 await p.getByLabel('Replace daily photo').setInputFiles(landscape);await button(p,'Expand photo').click();await p.waitForFunction(()=>document.querySelector('.daily-photo-expanded')?.complete);assert.equal(await p.locator('.daily-photo-expanded').evaluate(i=>i.naturalWidth),640);assert.ok((await p.locator('.daily-photo-expanded').boundingBox()).width<=p.viewportSize().width);await p.locator('#dialog').getByRole('button',{name:'Close',exact:true}).click();await button(p,'Save').click();await button(p,'Saved to cloud').waitFor();await reload(p);
 await p.getByLabel('Replace daily photo').setInputFiles({name:'broken.png',mimeType:'image/png',buffer:Buffer.from('synthetic invalid image')});await visible(p,'This browser cannot open that image');assert.ok(await p.locator('.daily-photo-preview').evaluate(i=>i.complete&&i.naturalWidth===640));await reload(p);await button(p,'Back to daily photos').click();await p.getByRole('img',{name:'Synthetic cyan landscape',exact:true}).waitFor();assert.equal(await p.getByRole('img',{name:'Synthetic cyan landscape',exact:true}).count(),1);await p.getByText('Synthetic cyan landscape',{exact:true}).waitFor();await p.waitForFunction(()=>[...document.querySelectorAll('.daily-photo-grid img')].every(i=>i.complete&&i.naturalWidth>0));
}

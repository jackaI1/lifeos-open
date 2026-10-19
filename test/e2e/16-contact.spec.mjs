import {assert,button,visible,go,reload,saveNote,lecture,draw,ask} from './helpers.mjs';
export default async function({page:p,configured}){
await go(p,'friends?entry=demo-maya');const before=await p.locator('[data-next-contact]').innerText();const savedContact=p.waitForResponse(r=>new URL(r.url()).pathname==='/api/private-friends/demo-maya/complete'&&r.request().method()==='POST');await button(p,'Log contact').click();const response=await savedContact;assert.ok(response.ok(),'Contact completion failed');const persisted=await response.json();assert.ok(persisted.item.data.dueDay>persisted.item.data.lastContactDay,'Next check-in must be after the logged contact');
// The UI displays a formatted date (e.g. Oct 19), not an ISO date. Wait for
// the rendered value to change before comparing it with a reloaded view.
await p.waitForFunction(previous=>document.querySelector('[data-next-contact]').textContent!==previous,before);await visible(p,'Next check-in');const next=await p.locator('[data-next-contact]').innerText();assert.notEqual(next,before);await reload(p);assert.equal(await p.locator('[data-next-contact]').innerText(),next);
}

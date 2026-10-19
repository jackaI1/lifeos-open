import {assert,button,visible,go,reload,saveNote,lecture,draw,ask} from './helpers.mjs';
export default async function({page:p,configured}){
await go(p,'today');await visible(p,'Wake up and get ready');await visible(p,'Until');const countdown=await p.locator('.now-countdown').innerText();await p.waitForTimeout(1200);assert.notEqual(await p.locator('.now-countdown').innerText(),countdown);await button(p,'Next schedule item').click();await visible(p,'Next');await reload(p);await visible(p,'Wake up and get ready');
}

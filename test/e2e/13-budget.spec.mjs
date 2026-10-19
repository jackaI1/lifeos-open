import {assert,button,visible,go,reload,saveNote,lecture,draw,ask} from './helpers.mjs';
export default async function({page:p,configured}){
await go(p,'finances');const before=await p.locator('.finance-allowances').innerText();await button(p,'Add transaction').click();await p.getByLabel('Merchant or description').fill('Synthetic grocery basket');await p.getByLabel('Expense amount').fill('8.25');await p.getByLabel('Category',{exact:true}).selectOption('dining');await button(p,'Save transaction').click();await visible(p,'Synthetic grocery basket');assert.notEqual(await p.locator('.finance-allowances').innerText(),before);await reload(p);await visible(p,'Synthetic grocery basket');
}

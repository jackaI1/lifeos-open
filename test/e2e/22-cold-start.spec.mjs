import {assert,button,go,reload,lecture,draw} from './helpers.mjs';
export default async function({page:p}){
 await go(p,'school?assistant=new');
 assert.ok(!/codex|gpt-6|astra/i.test(await p.locator('body').innerText()));
 await p.getByRole('button',{name:/Model and reasoning effort:/}).click();
 await p.locator('.assistant-effort output').getByText('Demo AI (offline)',{exact:true}).waitFor();await p.keyboard.press('Escape');
 const input=p.getByRole('textbox',{name:'Message',exact:true});await input.fill('Lab in 10 minutes, what do I need?');
 if(p.viewportSize().width>600)await input.press('Enter');else await button(p,'Send message').click();
 const reply=p.locator('.assistant-message.assistant').last();await reply.filter({hasText:'Room S-204'}).waitFor();const text=await reply.innerText();
 assert.doesNotMatch(text,/\d{4}-\d\d-\d\dT|Lab in 10 minutes|Mock academic/);assert.match(text,/safety goggles/);
 await input.fill('First line');await input.press('Shift+Enter');await input.type('Second line');assert.equal(await input.inputValue(),'First line\nSecond line');
 if(p.viewportSize().width<600){await input.fill('Phone draft');await input.press('Enter');assert.equal(await input.inputValue(),'Phone draft\n');}
 await go(p,'support');const support=p.getByRole('textbox',{name:'Message',exact:true});await support.fill('How do I save my notes?');if(p.viewportSize().width>600)await support.press('Enter');else await button(p,'Send message').click();await p.locator('.assistant-message.assistant').waitFor();await p.getByText('Reply saved',{exact:true}).waitFor();assert.equal(await p.locator('.job-result:visible').count(),0,'Finished support replies must appear once');
 await lecture(p);await button(p,'Pen').click();await draw(p);await p.waitForTimeout(4500);
 const prompts=[];const dialog=async d=>{prompts.push(d.type());await d.accept();};p.on('dialog',dialog);try{await reload(p);}finally{p.off('dialog',dialog);}assert.deepEqual(prompts,[],'Saved ink must not warn on reload');
}

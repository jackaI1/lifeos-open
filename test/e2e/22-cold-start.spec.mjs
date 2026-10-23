import {assert,button,go,reload,lecture,draw} from './helpers.mjs';
const placeholder='No AI is connected for this demo, try a question instead.';
export default async function({page:p}){
 await go(p,'school?assistant=new');
 assert.ok(!/codex|gpt-6|astra/i.test(await p.locator('body').innerText()));
 await p.getByRole('button',{name:/Model and reasoning effort:/}).click();
 await p.locator('.assistant-effort output').getByText('Demo AI (offline)',{exact:true}).waitFor();await p.keyboard.press('Escape');
 const input=p.getByRole('textbox',{name:'Message',exact:true});
 assert.equal(await input.getAttribute('placeholder'),placeholder);assert.equal(await input.evaluate(e=>e.readOnly),true);assert.equal(await input.getAttribute('aria-disabled'),'true');assert.equal(await button(p,'Send message').isEnabled(),false);
 await input.press('x');assert.equal(await input.inputValue(),'','Demo text cannot be typed');
 await button(p,'Prepare for the lab').click();
 const reply=p.locator('.assistant-message.assistant').last();await reply.filter({hasText:'Room S-204'}).waitFor();const text=await reply.innerText();
 assert.doesNotMatch(text,/\d{4}-\d\d-\d\dT|Lab in 10 minutes|Mock academic/);assert.match(text,/safety goggles/);
 assert.equal(await input.inputValue(),'');assert.equal(await button(p,'Send message').isEnabled(),false);
 await go(p,'support');const support=p.getByRole('textbox',{name:'Message',exact:true});assert.equal(await support.getAttribute('placeholder'),placeholder);assert.equal(await support.evaluate(e=>e.readOnly),true);assert.equal(await button(p,'Send message').isEnabled(),false);
 await button(p,'Find my notes').click();await p.locator('.assistant-message.assistant').filter({hasText:'Open Academics'}).waitFor();await p.getByText('Reply saved',{exact:true}).waitFor();assert.equal(await p.locator('.job-result:visible').count(),0,'Finished support replies must appear once');
 await lecture(p);await button(p,'Pen').click();await draw(p);await p.waitForTimeout(4500);
 const prompts=[];const dialog=async d=>{prompts.push(d.type());await d.accept();};p.on('dialog',dialog);try{await reload(p);}finally{p.off('dialog',dialog);}assert.deepEqual(prompts,[],'Saved ink must not warn on reload');
}

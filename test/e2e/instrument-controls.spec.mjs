import {assert,button,go} from './helpers.mjs';
export default async function({page:p}){
 await go(p,'prayer');
 await button(p,'Edit prayer requests').click();const editor=p.locator('.prayer-plain-editor');await editor.waitFor();const saved=await editor.inputValue();
 await editor.fill(saved+'\n- Synthetic Instrument draft');
 await button(p,'Discard prayer changes').click();assert.equal(await editor.count(),1);
 await button(p,'Confirm discard prayer changes').click();await editor.waitFor({state:'detached'});assert.equal(await editor.count(),0);
 await button(p,'Edit prayer requests').click();assert.equal(await editor.inputValue(),saved);
 await editor.fill(saved+'\n- Synthetic saved Instrument request');await button(p,'Save prayer requests').click();await editor.waitFor({state:'detached'});
 await button(p,'Edit prayer requests').click();assert.ok((await editor.inputValue()).includes('Synthetic saved Instrument request'));
 await button(p,'Save prayer requests').click();await editor.waitFor({state:'detached'});
 await go(p,'finances');
 for(const label of ['Giving surplus','Finance options']){
  const trigger=button(p,label);await trigger.click();const popup=p.locator('#'+await trigger.getAttribute('aria-controls'));await popup.waitFor();
  const placement=await popup.evaluate(node=>{const box=node.getBoundingClientRect(),nav=document.querySelector('#mobile-navigation')?.getBoundingClientRect();return {body:node.parentNode===document.body,top:box.top,bottom:box.bottom,right:box.right,width:innerWidth,limit:nav?.width&&nav.height?nav.top:innerHeight};});
  assert.equal(placement.body,true);assert.ok(placement.top>=11&&placement.bottom<=placement.limit&&placement.right<=placement.width);
  if(label==='Finance options'){await button(p,'Protected commitments').click();await p.locator('#dialog h2').filter({hasText:'Protected commitments'}).waitFor();}
  await p.keyboard.press('Escape');
 }
 const behavior=await p.evaluate(async()=>{
  const {notificationWidgets}=await import('/notification-widgets.js'),{el,button}=await import('/ui.js');let opened=0;
  const widget=notificationWidgets([{title:'Synthetic first alert',activate:()=>opened++},{title:'Synthetic second alert',activate:()=>opened++}]);document.querySelector('#main').append(widget.node);
  const collapsed=widget.node.querySelectorAll('.annunciator-card').length,plates=widget.node.querySelectorAll('.notification-plate').length;widget.node.querySelector('.notification-stack').click();const expanded=widget.node.querySelectorAll('.annunciator-card').length;widget.node.querySelector('.annunciator-card').click();widget.destroy();widget.node.remove();
  const option=el('option',{value:''},'Choose an item'),recordTitle=button('Edit',()=>{},'text-button list-button'),action=button('Edit',()=>{},'quiet');
  return {collapsed,plates,expanded,opened,placeholder:option.textContent,recordTitle:recordTitle.textContent,action:action.getAttribute('aria-label'),actionGlyph:!!action.querySelector('svg')};
 });
 assert.deepEqual(behavior,{collapsed:1,plates:1,expanded:2,opened:1,placeholder:'',recordTitle:'Edit',action:'Edit',actionGlyph:true});
}

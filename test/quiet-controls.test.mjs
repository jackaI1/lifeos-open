import test from 'node:test';
import assert from 'node:assert/strict';
import {compactDisclosure} from '../public/quiet-controls.js';

// DOM event fixture: exercise the production disclosure without a browser/server.
class Element extends EventTarget {
 constructor(tag){super();this.tagName=tag;this.children=[];this.attributes={};this.style={};this.hidden=false;}
 setAttribute(key,value){this.attributes[key]=String(value);if(key==='hidden')this.hidden=true;if(key==='id')this.id=value;}
 getAttribute(key){return this.attributes[key];}
 append(...children){for(const child of children){child.remove();child.parent=this;this.children.push(child);}}
 remove(){if(this.parent)this.parent.children=this.parent.children.filter(child=>child!==this);this.parent=null;}
 replaceChildren(...children){for(const child of [...this.children])child.remove();this.append(...children);}
 contains(target){return this===target||this.children.some(child=>child.contains(target));}
 getBoundingClientRect(){return {left:100,right:140,top:400,bottom:440,width:40,height:40};}
 matches(selector){return selector===':focus-visible'&&this.focusVisible===true;}
 querySelector(){return this.children.find(child=>['input','select','button'].includes(child.tagName))??null;}
 focus(){document.activeElement=this;}
}

function fixture(t){
 t.mock.timers.enable({apis:['setTimeout']});
 const previous=Object.fromEntries(['Node','document','window','innerHeight'].map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)]));
 const document=new EventTarget(),window=new EventTarget();
 Object.assign(document,{createElement:tag=>new Element(tag),createElementNS:(_ns,tag)=>new Element(tag),createTextNode:()=>new Element('#text'),body:new Element('body')});
 Object.assign(window,{innerWidth:1000});
 for(const [key,value] of Object.entries({Node:Element,document,window,innerHeight:800}))Object.defineProperty(globalThis,key,{value,writable:true,configurable:true});
 const slider=document.createElement('input'),control=compactDisclosure({label:'Reasoning effort',portal:true,content:()=>slider});
 const popup=control.node.children[1];document.body.append(control.node);
 t.after(()=>{control.destroy();for(const [key,descriptor] of Object.entries(previous)){if(descriptor)Object.defineProperty(globalThis,key,descriptor);else delete globalThis[key];}});
 return {control,popup,slider,document,window};
}
function send(target,type,properties={}){
 const event=new Event(type);for(const [key,value] of Object.entries({pointerType:'mouse',...properties}))Object.defineProperty(event,key,{value});target.dispatchEvent(event);
}

test('hover remains open while crossing the gap into a portaled effort slider',t=>{
 const {control,popup,slider,document}=fixture(t);
 send(control.node,'pointerenter');assert.equal(popup.hidden,false);
 send(control.node,'pointerleave',{relatedTarget:document.body});
 t.mock.timers.tick(80);
 assert.equal(popup.hidden,false,'The gap must not immediately dismiss the slider');
 send(popup,'pointerenter',{relatedTarget:document.body});
 t.mock.timers.tick(1000);
 assert.equal(popup.hidden,false,'Entering the popup must cancel the pending hover close');
 assert.equal(popup.children[0],slider);
 assert.equal(control.trigger.getAttribute('aria-expanded'),'true');
});

test('returning across the gap to the trigger cancels hover dismissal',t=>{
 const {control,popup,document}=fixture(t);
 send(control.node,'pointerenter');send(popup,'pointerenter');
 send(popup,'pointerleave',{relatedTarget:document.body});t.mock.timers.tick(80);
 assert.equal(popup.hidden,false);
 send(control.node,'pointerenter');t.mock.timers.tick(1000);
 assert.equal(popup.hidden,false);
});

test('leaving the disclosure entirely closes after the traversal grace period',t=>{
 const {control,popup,document}=fixture(t);
 send(control.node,'pointerenter');send(control.node,'pointerleave',{relatedTarget:document.body});
 assert.equal(popup.hidden,false);
 t.mock.timers.tick(1000);assert.equal(popup.hidden,true);
 assert.equal(control.trigger.getAttribute('aria-expanded'),'false');
});

test('a focused slider remains usable when its pointer leaves',t=>{
 const {control,popup,slider,document}=fixture(t);
 control.show();slider.focus();send(popup,'pointerleave',{relatedTarget:document.body});
 t.mock.timers.tick(1000);assert.equal(popup.hidden,false);
 send(popup,'focusout',{relatedTarget:document.body});assert.equal(popup.hidden,true);
});

test('outside click closes immediately and stationary pointer cannot reopen the popup',t=>{
 const {control,popup,document}=fixture(t);
 send(control.node,'pointerenter');send(control.node,'pointerleave',{relatedTarget:document.body});
 send(document.body,'pointerdown'); // The fixture does not bubble events.
 send(document,'pointerdown',{clientX:120,clientY:420});
 assert.equal(popup.hidden,true);
 send(control.node,'pointerenter',{clientX:120,clientY:420});assert.equal(popup.hidden,true);
 send(control.node,'pointermove',{clientX:121,clientY:420});assert.equal(popup.hidden,false);
 t.mock.timers.tick(1000);assert.equal(popup.hidden,false,'Outside click must cancel the older hover timer');
});

test('Escape closes and returns keyboard focus, with a deliberate click able to reopen',t=>{
 const {control,popup,slider,document}=fixture(t);
 control.trigger.focusVisible=true;control.show();assert.equal(document.activeElement,slider);
 send(document,'keydown',{key:'Escape'});assert.equal(popup.hidden,true);
 assert.equal(document.activeElement,control.trigger);
 send(control.trigger,'click');assert.equal(popup.hidden,false);
 send(document,'pointerdown');assert.equal(popup.hidden,true);
 send(control.trigger,'click');assert.equal(popup.hidden,false);
 send(control.trigger,'click');assert.equal(popup.hidden,true);
});

test('resize and destroy close portaled content and release document listeners',t=>{
 const {control,popup,document,window}=fixture(t);
 control.show();send(window,'resize');assert.equal(popup.hidden,true);
 control.show();send(control.node,'pointerleave',{relatedTarget:document.body});control.destroy();
 assert.equal(document.body.contains(popup),false);
 t.mock.timers.tick(1000);
 const expanded=control.trigger.getAttribute('aria-expanded');
 send(document,'pointerdown');send(document,'keydown',{key:'Escape'});send(window,'resize');
 assert.equal(control.trigger.getAttribute('aria-expanded'),expanded);
});

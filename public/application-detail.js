import {el,modal,button} from './ui.js';
const questions=['What does this passage demand of me?','How does this passage change the way I relate to people?'];
export function applicationAnswer(text){
 const parts=String(text??'').split(/(Small Step:\s*[^.!?\n]+(?:[.!?]|$))/gi);
 return el('div',{class:'application-answer detail-body'},...parts.map(part=>/^Small Step:/i.test(part)?el('mark',{class:'application-small-step'},el('strong',{},part)):document.createTextNode(part)));
}
export function openApplication(application,open){
 const content=el('div',{class:'application-detail'},...[application.answer,application.peopleAnswer].map((answer,i)=>answer?el('section',{},el('p',{},el('em',{},`Arrow ${i+5}, ${questions[i]}`)),applicationAnswer(answer)):null),button('Open devotional',open,'quiet'));
 const dialog=modal(application.passage+', Application',content);
 requestAnimationFrame(()=>{const first=dialog.querySelector('.application-small-step');if(first&&dialog.open){const box=first.getBoundingClientRect(),bounds=dialog.getBoundingClientRect();dialog.scrollTop+=Math.max(0,box.top-bounds.top-100);}});
}

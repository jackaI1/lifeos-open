import {Marked} from './vendor/marked/marked.esm.js';
import {el} from './ui.js';

// Tokens become allowlisted DOM nodes, never model-supplied HTML. Preserve TeX
// delimiters for the existing KaTeX pass, including escaped parentheses/brackets.
const parser=new Marked({gfm:true,breaks:true,extensions:[{name:'math',level:'inline',start:s=>s.search(/\\[([]|\$/),tokenizer(s){const m=/^(\\\([\s\S]*?\\\)|\\\[[\s\S]*?\\\]|\$\$[\s\S]*?\$\$|\$[^\n$]+?\$)/.exec(s);if(m)return {type:'math',raw:m[0],text:m[0]};}}]});
const safeUrl=value=>{try{const u=new URL(value);return ['https:','http:'].includes(u.protocol)&&!u.username&&!u.password?u.href:null;}catch{return null;}};
export function markdownNodes(text){
 const render=(tokens,depth=0)=>depth>30?[document.createTextNode('Content nesting limit reached')]:tokens.flatMap(t=>{
  const children=()=>render(t.tokens??[],depth+1);
  switch(t.type){
   case 'space':case 'def':return [];
   case 'heading':return el('h'+Math.min(6,t.depth+1),{},children());
   case 'paragraph':return el('p',{},children());
   case 'strong':return el('strong',{},children());
   case 'em':return el('em',{},children());
   case 'del':return el('del',{},children());
   case 'blockquote':return el('blockquote',{},children());
   case 'hr':return el('hr');
   case 'br':return el('br');
   case 'code':return el('pre',{},el('code',{},t.text));
   case 'codespan':return el('code',{},t.text);
   case 'list':return el(t.ordered?'ol':'ul',t.ordered?{start:t.start||1}:{},t.items.map(i=>el('li',{},i.task?el('input',{type:'checkbox',checked:i.checked,disabled:true,'aria-label':i.checked?'Completed item':'Incomplete item'}):null,render(i.tokens,depth+1))));
   case 'link':{const href=safeUrl(t.href);return href?el('a',{href,target:'_blank',rel:'noopener noreferrer'},children()):children();}
   case 'image':return document.createTextNode(t.text||'[Image]');
   case 'table':return el('div',{class:'assistant-table',tabindex:0,role:'region','aria-label':'Table'},el('table',{},el('thead',{},el('tr',{},t.header.map(c=>el('th',{scope:'col'},render(c.tokens,depth+1))))),el('tbody',{},t.rows.map(row=>el('tr',{},row.map(c=>el('td',{},render(c.tokens,depth+1))))))));
   case 'text':return t.tokens?children():document.createTextNode(t.text);
   default:return document.createTextNode(t.text??t.raw??'');
  }
 });
 try{return render(parser.lexer(String(text).slice(0,50000)));}catch{return [document.createTextNode(String(text))];}
}
export function markdownMessage(text){return el('div',{class:'assistant-message-text assistant-markdown'},markdownNodes(text));}

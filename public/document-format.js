// Shared storage contract. Rich text is structured data, never arbitrary HTML.
export const DOCUMENT_FONTS=['Arial','Georgia','Times New Roman','Verdana','Courier New','system-ui'];
const nodes=new Set(['doc','paragraph','heading','text','bulletList','orderedList','listItem','taskList','taskItem','blockquote','codeBlock','hardBreak','horizontalRule','table','tableRow','tableCell','tableHeader']);
const marks=new Set(['bold','italic','underline','strike','code','link','textStyle','highlight']);
export function plainDocument(text=''){return {type:'doc',content:String(text).split('\n').map(line=>({type:'paragraph',...(line?{content:[{type:'text',text:line}]}:{})}))};}
export function documentText(doc){const walk=n=>n.type==='text'?n.text:n.type==='hardBreak'?'\n':(n.content??[]).map(walk).join(['doc','bulletList','orderedList','taskList','table','tableRow'].includes(n.type)?'\n':'');return walk(doc);}
export function validateDocument(doc){let count=0,characters=0;
 function attrs(value,type){const out={};for(const[k,v]of Object.entries(value??{})){
  if(v==null||v==='')continue;
  if(k==='level'&&type==='heading'&&[1,2,3,4,5,6].includes(v))out[k]=v;
  else if(k==='textAlign'&&['left','center','right','justify'].includes(v))out[k]=v;
  else if(k==='checked'&&type==='taskItem'&&typeof v==='boolean')out[k]=v;
  else if(k==='start'&&type==='orderedList'&&Number.isInteger(v)&&v>0&&v<10000)out[k]=v;
  else if(['colspan','rowspan'].includes(k)&&Number.isInteger(v)&&v>=1&&v<=30)out[k]=v;
  else if(k==='colwidth'&&Array.isArray(v)&&v.length<=30&&v.every(x=>Number.isInteger(x)&&x>=20&&x<=2000))out[k]=v;
  else if(k==='fontFamily'&&DOCUMENT_FONTS.includes(v))out[k]=v;
  else if(k==='fontSize'&&/^(?:[89]|[1-3]\d|4[0-8])(?:px|pt)$/.test(v))out[k]=v;
  else if(['color','backgroundColor'].includes(k)&&/^#[\da-f]{6}$/i.test(v))out[k]=v;
  else if(k==='lineHeight'&&['1','1.15','1.5','2'].includes(String(v)))out[k]=String(v);
  else if(k==='language'&&type==='codeBlock'&&typeof v==='string'&&/^[\w+-]{0,40}$/.test(v))out[k]=v;
  else if(type==='link'&&k==='href'){const url=new URL(v);if(!['https:','mailto:'].includes(url.protocol)||url.username||url.password)throw Error('Use a safe HTTPS link');out.href=url.href;}
  else if(type==='link'&&['target','rel','class'].includes(k)){/* server owns link behavior */}
  else throw Error('Unsupported document formatting: '+k);
 }if(type==='link'){out.target='_blank';out.rel='noopener noreferrer';}return out;}
 function visit(n,depth=0){if(++count>10000||depth>24||!n||typeof n!=='object'||!nodes.has(n.type))throw Error('Document structure is too large or unsupported');for(const k of Object.keys(n))if(!['type','attrs','content','text','marks'].includes(k))throw Error('Unsupported document field');const out={type:n.type};
  if(n.type==='text'){if(typeof n.text!=='string')throw Error('Document text is required');characters+=n.text.length;if(characters>200000)throw Error('Document exceeds 200,000 characters');out.text=n.text;}
  if(n.attrs)out.attrs=attrs(n.attrs,n.type);
  if(n.marks){if(!Array.isArray(n.marks)||n.marks.length>10)throw Error('Too many text marks');out.marks=n.marks.map(m=>{if(!marks.has(m.type)||Object.keys(m).some(k=>!['type','attrs'].includes(k)))throw Error('Unsupported text mark');return {type:m.type,...(m.attrs?{attrs:attrs(m.attrs,m.type)}:{})};});}
  if(n.content){if(!Array.isArray(n.content))throw Error('Invalid document content');out.content=n.content.map(c=>visit(c,depth+1));}return out;}
 if(doc?.type!=='doc')throw Error('A document is required');return visit(doc);
}

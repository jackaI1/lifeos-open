export function assistantMathOptions({inlineDollar=false}={}) {
  return {throwOnError:false,trust:false,strict:'ignore',maxExpand:500,maxSize:10,output:'htmlAndMathml',macros:{},
    delimiters:[{left:'$$',right:'$$',display:true},{left:'\\(',right:'\\)',display:false},{left:'\\[',right:'\\]',display:true},
      ...['equation','align','gather'].map(name=>({left:'\\begin{'+name+'}',right:'\\end{'+name+'}',display:true})),
      ...(inlineDollar?[{left:'$',right:'$',display:false}]:[])]};
}
let runtime;
export async function renderAssistantMath(node,options={}) {
  const text=node.textContent;
  if(!text||text.length>50000||!/[\\$]/.test(text)||(text.match(/\\\(|\\\[|\$\$/g)??[]).length>160)return;
  try {
    if(!document.querySelector('#lifeos-math-css')){const link=document.createElement('link');link.id='lifeos-math-css';link.rel='stylesheet';link.href='/vendor/katex/katex.min.css';document.head.append(link);}
    runtime??=import('./vendor/katex/contrib/auto-render.mjs');const {default:render}=await runtime;
    if(node.isConnected&&node.textContent===text)render(node,assistantMathOptions(options));
  } catch { /* The complete source answer stays readable if math cannot render. */ }
}

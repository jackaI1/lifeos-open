// This module is loaded only by the separately hosted fictional demo.
const bar=document.createElement('div');bar.className='demo-controls';bar.setAttribute('aria-label','Demo controls');
const label=document.createElement('span');label.textContent='Fictional demo · edits expire after 24 hours of inactivity. Please use made-up information.';
const download=document.createElement('a');download.href='/api/export';download.download='lifeos-demo-export.json';download.textContent='Export demo';
const reset=document.createElement('button');reset.type='button';reset.textContent='Reset demo';
reset.addEventListener('click',async()=>{if(!confirm('Reset this fictional demo? Export any demo changes you want to keep first.'))return;reset.disabled=true;try{const session=await(await fetch('/api/session')).json();const r=await fetch('/api/demo/reset',{method:'POST',headers:{'x-lifeos-csrf':session.csrf}});if(!r.ok)throw Error();location.reload();}catch{reset.disabled=false;label.textContent='Demo reset did not finish. Your saved changes remain.';}});
bar.append(label,download,reset);document.body.prepend(bar);
document.body.classList.add('hosted-demo');
const style=document.createElement('style');style.textContent=`
:root{--demo-control-size:44px;--demo-inline-gap:1rem;--demo-inset:1rem;--demo-bar-bg:#142236;--demo-bar-text:#c9d5e4}
.hosted-demo{display:grid;grid-template-rows:auto minmax(0,1fr);height:100svh;overflow:hidden}
.demo-controls{display:flex;align-items:center;gap:var(--demo-inline-gap);padding:.25rem var(--demo-inset);background:var(--demo-bar-bg);color:var(--demo-bar-text);font:13px/1.45 system-ui;min-height:var(--demo-control-size)}
.demo-controls span{flex:1}.demo-controls a,.demo-controls button{color:inherit;font:inherit;padding:.5rem;min-height:var(--demo-control-size);white-space:nowrap}
.demo-controls button{border:0;background:transparent;cursor:pointer}.demo-controls a:focus-visible,.demo-controls button:focus-visible{outline:2px solid currentColor;outline-offset:2px}
.hosted-demo .app-shell{grid-row:2;min-height:0;height:auto}
@media(max-width:600px){:root{--demo-inline-gap:.25rem;--demo-inset:.5rem}.demo-controls{flex-wrap:wrap}.demo-controls span{flex-basis:100%;font-size:12px}.demo-controls a{margin-left:auto}}
`;document.head.append(style);

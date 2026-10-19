export function outsideDialog(dialog,event){const r=dialog.getBoundingClientRect();return event.target===dialog&&(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom);}
export function dismissOnOutside(element,close,{doc=document,isOutside=e=>!element.contains(e.target),enabled=()=>true}={}){
 let pointer=null;
 const down=e=>{pointer=enabled()&&e.button===0&&e.isPrimary!==false&&isOutside(e)?e.pointerId:null;};
 const up=e=>{const dismiss=pointer!==null&&pointer===e.pointerId&&e.button===0&&enabled()&&isOutside(e);pointer=null;if(dismiss)void close();};
 const cancel=()=>{pointer=null;};
 doc.addEventListener('pointerdown',down);doc.addEventListener('pointerup',up);doc.addEventListener('pointercancel',cancel);
 return ()=>{doc.removeEventListener('pointerdown',down);doc.removeEventListener('pointerup',up);doc.removeEventListener('pointercancel',cancel);};
}
export function anchorDialog(dialog,{win=window,doc=document}={}){
 const y=win.scrollY||0,bodyStyle=doc.body.style.cssText,overflow=doc.documentElement.style.overflow,dialogStyle=dialog.style.cssText;
 Object.assign(doc.body.style,{position:'fixed',top:-y+'px',left:'0',right:'0',width:'100%'});doc.documentElement.style.overflow='hidden';
 const place=()=>{const v=win.visualViewport;Object.assign(dialog.style,{position:'fixed',margin:'0 auto',left:'0',right:'0',bottom:'auto',top:Math.max(12,(v?.offsetTop??0)+12)+'px',maxHeight:Math.max(100,(v?.height??win.innerHeight)-24)+'px'});};
 const dismiss=dismissOnOutside(dialog,()=>dialog.close(),{doc:dialog,isOutside:e=>outsideDialog(dialog,e)});
 win.visualViewport?.addEventListener('resize',place);place();
 return ()=>{dismiss();win.visualViewport?.removeEventListener('resize',place);doc.body.style.cssText=bodyStyle;doc.documentElement.style.overflow=overflow;dialog.style.cssText=dialogStyle;return y;};
}

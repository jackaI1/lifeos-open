// Use browser text layout, not character counts. Proportional fonts and word wrapping
// otherwise put the real caret offscreen and fight the browser's own caret reveal.
export function responseCaretMeasure(input){
 const mirror=document.createElement('div');mirror.setAttribute('aria-hidden','true');
 mirror.style.cssText='position:fixed;left:0;top:0;visibility:hidden;pointer-events:none;box-sizing:border-box;white-space:pre-wrap;overflow-wrap:break-word;height:auto;min-height:0;max-height:none;margin:0;';
 document.body.append(mirror);
 const measure=()=>{
  const rect=input.getBoundingClientRect(),css=getComputedStyle(input);
  for(const key of ['fontFamily','fontSize','fontWeight','fontStyle','fontStretch','fontVariant','lineHeight','letterSpacing','wordSpacing','textIndent','textTransform','textAlign','direction','paddingTop','paddingBottom','paddingLeft','paddingRight','borderTopWidth','borderBottomWidth','borderLeftWidth','borderRightWidth','borderStyle','tabSize','wordBreak','overflowWrap'])mirror.style[key]=css[key];
  mirror.style.width=rect.width+'px';
  const at=input.selectionEnd??input.value.length,marker=document.createElement('span');marker.textContent='\u200b';
  mirror.replaceChildren(document.createTextNode(input.value.slice(0,at)),marker,document.createTextNode(input.value.slice(at)));
  const caret=marker.getBoundingClientRect(),box=mirror.getBoundingClientRect();
  return {top:rect.top+caret.top-box.top-(input.scrollTop||0),height:caret.height};
 };
 measure.destroy=()=>mirror.remove();return measure;
}
// Follow editing intent, never move selection or scroll merely because a save finished.
export function followResponseFocus(input,{measureCaret}={}){
 const measure=measureCaret??responseCaretMeasure(input);
 let frame=0,disposed=false;
 const center=()=>{cancelAnimationFrame(frame);frame=requestAnimationFrame(()=>{
  if(disposed||document.activeElement!==input)return;
  const viewport=window.visualViewport,top=viewport?.offsetTop??0,height=viewport?.height??innerHeight,rect=input.getBoundingClientRect();
  const caret=measure(),caretCenter=caret.top+caret.height/2;
  // Center compact fields, but constrain that anchor around the actual typing line.
  // This changes continuously as the box grows, without a short/long mode switch.
  const anchor=Math.max(caretCenter-height*.15,Math.min(rect.top+rect.height/2,caretCenter+height*.15));
  const delta=anchor-(top+height*.5);
  if(Math.abs(delta)>height*.16)window.scrollBy({top:delta,behavior:'instant'});
 });};
 input.addEventListener('focus',center);input.addEventListener('input',center);window.visualViewport?.addEventListener('resize',center);
 return {destroy(){disposed=true;cancelAnimationFrame(frame);measure.destroy?.();input.removeEventListener('focus',center);input.removeEventListener('input',center);window.visualViewport?.removeEventListener('resize',center);}};
}

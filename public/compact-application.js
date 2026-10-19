export function applicationCandidates(text){
 const original=String(text??'').replace(/…|\.{3,}/g,' ').replace(/\s+/g,' ').trim();
 const compact=original.replace(/^(?:I (?:will|want to|need to|am going to)|My (?:small step|application) is to|Try to|Make sure (?:that )?I)\s+/i,'').replace(/\b(?:tomorrow|today|this week)\b/gi,'').replace(/\bin order to\b/gi,'to').replace(/\b(?:really|actually|very|just)\b\s*/gi,'').replace(/\s+/g,' ').replace(/[. ]+$/,'');
 const action=compact.replace(/^(?:when|if|whenever)\b[^,;]+[,;]\s*(?:I (?:will|should|need to)\s+)?/i,'').split(/\s+(?:because|so that|in order that)\s+/i)[0];
 const direct=action.replace(/\bby (?:asking|talking|speaking) about (?:their |his |her )?/gi,'about ').replace(/\b(?:take the time to|make an effort to|remember to)\s*/gi,'').replace(/\bso I can\b/gi,'to');
 const brief=direct.replace(/\b(?:a|an|the|my|short)\s+/gi,'').replace(/\bthat is in me\b/gi,'').replace(/\s+/g,' ').trim();
 const shorter=brief.replace(/^reach out to\s+/i,'Contact ').replace(/\bby asking about (?:their )?/gi,'about ').replace(/\bone friend\b/gi,'friend');
 return [...new Set([original,compact,action,direct,brief,shorter].filter(Boolean))];
}
export function fitApplication(text,measure,width){
 const options=applicationCandidates(text);for(const option of options)if(measure(option)<=width)return option;
 const words=(options.at(-1)||'').split(' ');
 while(words.length>1&&measure(words.join(' '))>width)words.pop();
 while(words.length>1&&/^(?:a|an|the|to|for|of|and|or|with|from|in|on|about|their|his|her|my|your|by|asking)$/i.test(words.at(-1)))words.pop();
 const summary=words.join(' ').replace(/[,;:]$/,'');return measure(summary)<=width?summary:(measure('Open')<=width?'Open':'');
}
export function fitApplicationLines(node,texts,{selector='.application-line',lines=1}={}){
 const context=document.createElement('canvas').getContext('2d');let frame=0,dead=false;
 const fit=()=>{cancelAnimationFrame(frame);frame=requestAnimationFrame(()=>{if(dead||!node.isConnected||!context)return;const width=node.clientWidth-8;if(width<20)return;node.querySelectorAll(selector).forEach((line,i)=>{const css=getComputedStyle(line);context.font=css.font||`${css.fontWeight} ${css.fontSize} ${css.fontFamily}`;line.textContent=fitApplication(texts[i],s=>context.measureText(s).width,width*lines);});});};
 const observer=new ResizeObserver(fit);observer.observe(node);fit();return()=>{dead=true;cancelAnimationFrame(frame);observer.disconnect();};
}

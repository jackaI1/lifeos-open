import {anchorDialog} from './dialog-position.js';
import {lifeosDay} from './lifeos-day.js';
export const $ = (selector, root = document) => root.querySelector(selector);
export function replace(node, ...children) { node.replaceChildren(...children.flat(Infinity).filter(child => child != null && child !== false)); }
export function append(node, ...children) { node.append(...children.flat(Infinity).filter(child => child != null && child !== false)); }
export function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value == null || value === false) continue;
    if (key.startsWith('on') && typeof value === 'function') node.addEventListener(key.slice(2).toLowerCase(), value);
    else if (key === 'class') node.className = value;
    else if (key === 'value') node.value = value;
    else if (key === 'checked') node.checked = !!value;
    else node.setAttribute(key, value === true ? '' : String(value));
  }
  for (const child of children.flat(Infinity)) if (child != null && child !== false) node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  return node;
}
export const button = (text, onclick, className = '') => el('button', { type: 'button', class: className, onclick }, text);
export const status = (text, kind = '') => el('span', { class: `status ${kind}` }, text);
export const empty = text => el('div', { class: 'empty' }, text);
export const panel = (title, ...children) => el('section', { class: 'panel' }, title ? el('h2', {}, title) : null, children);
export const heading = (title, subtitle, actions) => el('div', { class: 'page-heading' }, el('div', {}, el('h1', {}, title), subtitle ? el('p', {}, subtitle) : null), actions);
export function sectionTabs(items,value,onChange){
 const id='tabs-'+crypto.randomUUID(),node=el('div',{class:'page-tabs',role:'tablist'}),buttons=[];
 const choose=(next,focus=false)=>{value=next;buttons.forEach((b,i)=>{b.setAttribute('aria-selected',String(items[i].id===value));b.tabIndex=items[i].id===value?0:-1;});if(focus)buttons[items.findIndex(i=>i.id===value)].focus();onChange(value,id+'-'+value);};
 items.forEach((item,index)=>{const b=button(item.label,()=>choose(item.id),'text-button');b.id=id+'-'+item.id;b.setAttribute('role','tab');b.setAttribute('aria-controls',id+'-panel');b.setAttribute('aria-selected',String(item.id===value));b.tabIndex=item.id===value?0:-1;b.addEventListener('keydown',e=>{if(!['ArrowLeft','ArrowRight','Home','End'].includes(e.key))return;e.preventDefault();const target=e.key==='Home'?0:e.key==='End'?items.length-1:(index+(e.key==='ArrowRight'?1:-1)+items.length)%items.length;choose(items[target].id,true);});buttons.push(b);node.append(b);});
 return {node,panelId:id+'-panel',labelId:id+'-'+value,set:choose};
}
export const field = (label, options = {}) => { const input = el(options.multiline ? 'textarea' : 'input', { ...options, multiline: null }); return { input, node: el('label', {}, label, input) }; };
export const select = (label, options, value = '') => { const input = el('select', {'aria-label':label}, options.map(option => el('option', { value: option.value ?? option, selected: (option.value ?? option) === value }, option.label ?? option))); return { input, node: el('label', {}, label, input) }; };
let displayTimeZone='America/Toronto';
export function setDisplayTimeZone(value){new Intl.DateTimeFormat('en',{timeZone:value});displayTimeZone=value;}
export const getDisplayTimeZone=()=>displayTimeZone;
export const dateToday = () => lifeosDay(Date.now(),displayTimeZone);
export function formatDate(value, long = false) { if (!value) return 'Date unknown'; const date = new Date(value.length === 10 ? `${value}T12:00:00Z` : value); return Number.isNaN(date.valueOf()) ? 'Date unknown' : new Intl.DateTimeFormat(undefined, { month: long ? 'long' : 'short', day: 'numeric', ...(long ? { weekday: 'long', year: 'numeric' } : {}), timeZone: value.length === 10 ? 'UTC' : displayTimeZone }).format(date); }
export function formatTime(value) { if (!value) return ''; if (/^\d{2}:\d{2}$/.test(value)) return value; const date = new Date(value); return Number.isNaN(date.valueOf()) ? '' : new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit', timeZone: displayTimeZone }).format(date); }
export function compactTime(value){
 if(!value)return '';let hour,minute;
 if(/^\d{2}:\d{2}$/.test(value)){[hour,minute]=value.split(':').map(Number);}
 else{const date=new Date(value);if(!Number.isFinite(date.valueOf()))return '';const parts=new Intl.DateTimeFormat('en-GB',{hour:'2-digit',minute:'2-digit',hourCycle:'h23',timeZone:displayTimeZone}).formatToParts(date);hour=Number(parts.find(p=>p.type==='hour').value);minute=Number(parts.find(p=>p.type==='minute').value);}
 return `${hour%12||12}:${String(minute).padStart(2,'0')}${hour<12?'a':'p'}`;
}
export function duration(minutes) { if (minutes == null || minutes === '' || !Number.isFinite(Number(minutes))) return 'Unknown'; const n = Math.max(0, Math.round(Number(minutes))); return n < 60 ? `${n} min` : `${Math.floor(n / 60)}h${n % 60 ? ` ${n % 60}m` : ''}`; }
let externalOrigins=null;
export function configureExternalLinks(origins){externalOrigins=new Set(origins);}
export function safeLink(url, label = 'Open source') { if (typeof url !== 'string' || !url.trim()) return null; try { const parsed = new URL(url, location.origin);if(parsed.origin!==location.origin&&externalOrigins&&!externalOrigins.has(parsed.origin))return null; if (!['https:', 'http:'].includes(parsed.protocol) || (parsed.protocol === 'http:' && parsed.origin !== location.origin)) return el('span', { class: 'muted' }, 'Source link unavailable'); return el('a', { href: parsed.href, target: '_blank', rel: 'noopener noreferrer', class: 'source-link' }, label); } catch { return null; } }
export function toast(message) { const node = $('#toast'); node.textContent = message; node.hidden = false; clearTimeout(toast.timer); toast.timer = setTimeout(() => { node.hidden = true; }, 6000); }
export function modal(title, content, options = {}) {
  const dialog = $('#dialog'); if (dialog.open) { const previous=dialog.onclose;dialog.onclose=null;dialog.close();previous?.(); }
  const scrollY = window.scrollY || 0, openedRoute=location.hash; const titleNode = el('h2', {tabindex:'-1', id:'dialog-title'}, title);
  const close=button(icon('close'),()=>dialog.close(),'quiet icon-button');close.setAttribute('aria-label','Close');
  dialog.replaceChildren(el('div', { class: 'dialog-heading' }, titleNode, close), el('div', { class: 'dialog-content' }, content));
  dialog.setAttribute('aria-labelledby','dialog-title');
  const unlock=anchorDialog(dialog);
  dialog.onclose = () => { if(dialog.open)return;unlock();if(location.hash===openedRoute)window.scrollTo?.({top:scrollY,left:0,behavior:'instant'}); options.onclose?.(); };
  dialog.showModal();titleNode.focus({preventScroll:true});dialog.scrollTop=0;return dialog;
}
export function download(name, value, type = 'text/plain') { const url = URL.createObjectURL(value instanceof Blob ? value : new Blob([value], { type })); const link = el('a', { href: url, download: name }); link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); }
export function errorNotice(error) { return el('div', { class: 'notice error', role: 'alert' }, error?.message || String(error)); }
export async function busy(buttonNode, task) { const old=[...buttonNode.childNodes],iconOnly=buttonNode.classList.contains('icon-button'),pending=el('span',{},'Working…');buttonNode.disabled=true;buttonNode.setAttribute('aria-busy','true');if(!iconOnly)buttonNode.replaceChildren(pending);try{return await task();}catch(error){toast(error.message);return null;}finally{buttonNode.disabled=false;buttonNode.removeAttribute('aria-busy');if(!iconOnly&&buttonNode.firstChild===pending)buttonNode.replaceChildren(...old);} }
export const recordData = record => record?.data || record || {};
export function showResult(result, fallback = 'Saved') { toast(result?.pending ? result.reason : fallback); }
export const icon = name => {
  const paths = {email:'M3 5h18v14H3z M3 5l9 7 9-7',notes:'M4 3h16v18H4z M8 7h8 M8 11h8 M8 15h5',friends:'M10 7a3 3 0 1 1-6 0 3 3 0 0 1 6 0 M2 21v-4a5 5 0 0 1 10 0v4 M16 4a3 3 0 0 1 0 6 M16 13a5 5 0 0 1 5 5v3',journal:'M5 3h14v18H5z M9 7h6 M9 11h6 M9 15h4',photos:'M3 6h4l2-3h6l2 3h4v15H3z M16 13a4 4 0 1 1-8 0 4 4 0 0 1 8 0',finances:'M3 6h18v15H3z M3 6l14-3v3 M15 12h6v5h-6z M17 14h1',close:'M6 6l12 12 M18 6 6 18',left:'m15 5-7 7 7 7',right:'m9 5 7 7-7 7',pen:'m4 20 4-1 12-12-3-3L5 16l-1 4 M14 7l3 3',retry:'M20 7v5h-5 M20 12a8 8 0 1 0-2 5', reminders:'M8 6h13 M8 12h13 M8 18h13 M3 5l1 1 2-2 M3 11l1 1 2-2 M3 17l1 1 2-2', today: 'M3 10 12 3l9 7v10H3z M9 20v-7h6v7', devotional: 'M12 5c-4-3-9-1-9-1v15s5-2 9 1c4-3 9-1 9-1V4s-5-2-9 1v15', prayer: 'M12 3v3 M4 7l2 2 M20 7l-2 2 M5 18c2-1 2-7 4-7h2v8l-3 2 M19 18c-2-1-2-7-4-7h-2v8l3 2', school: 'm2 8 10-5 10 5-10 5z M6 10v7c4 3 8 3 12 0v-7 M22 8v8', tickets: 'M3 5h18v5a2 2 0 0 0 0 4v5H3v-5a2 2 0 0 0 0-4z M15 5v14', exercise: 'M15 4h1 M9 10l3-4 4 4 3 1 M12 6l-1 7-5 7 M11 13l5 2-1 6 M5 10l4 1', meals: 'M4 3v7h5V3 M6.5 10v11 M18 3c-5 2-5 10 0 10V3v18', support: 'M3 4h18v13H9l-5 4v-4H3z M7 8h10 M7 12h6', settings: 'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8 M10 3h4l1 3 3 1 3-1 2 4-2 2v3l2 2-2 4-3-1-3 1-1 3h-4l-1-3-3-1-3 1-2-4 2-2v-3L1 10l2-4 3 1 3-1z', more: 'M4 6h16 M4 12h16 M4 18h16' };
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('fill', 'none'); svg.setAttribute('stroke', 'currentColor'); svg.setAttribute('stroke-width', '1.5'); svg.setAttribute('stroke-linecap', 'round'); svg.setAttribute('stroke-linejoin', 'round'); svg.setAttribute('aria-hidden', 'true'); const path = document.createElementNS(svg.namespaceURI, 'path'); path.setAttribute('d', paths[name] || paths.more); svg.append(path); return svg;
};

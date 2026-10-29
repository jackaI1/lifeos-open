// Palette miniatures mirror the primitive values in styles.css.
export const themes=Object.freeze([
 {"id":"graphite","name":"Graphite","chassis":"#2B2D30","display":"#15191A","displayInk":"#E8F0EC","ink":"#F1F1EE","primary":"#F6C343"},
 {"id":"midnight","name":"Midnight","chassis":"#121620","display":"#070A10","displayInk":"#D8E4F7","ink":"#E7EBF3","primary":"#E8B34B"},
 {"id":"desk","name":"Desk","chassis":"#E4E3DF","display":"#1C2022","displayInk":"#E9EFEB","ink":"#1B1C1E","primary":"#F2B21B"},
 {"id":"aluminium","name":"Aluminium","chassis":"#CDD0D2","display":"#050505","displayInk":"#F4F4F4","ink":"#141516","primary":"#FF5E1A"},
 {"id":"handheld","name":"Handheld","chassis":"#C9C7C0","display":"#A3AC6E","displayInk":"#22341A","ink":"#26262B","primary":"#A0245C"},
 {"id":"field","name":"Field radio","chassis":"#383C30","display":"#121410","displayInk":"#F2AE3D","ink":"#EBEAE0","primary":"#E3A23B"},
 {"id":"cassette","name":"Cassette","chassis":"#2C4561","display":"#0E1824","displayInk":"#E3ECF5","ink":"#EEF3F8","primary":"#F07B2C"},
 {"id":"calculator","name":"Calculator","chassis":"#26221F","display":"#A8AD9C","displayInk":"#1C1F1A","ink":"#F0ECE4","primary":"#E3A43C"},
 {"id":"platinum","name":"Platinum","chassis":"#D4D4D4","display":"#F7F7F5","displayInk":"#111111","ink":"#111111","primary":"#111111"},
 {"id":"nightdrive","name":"Night drive","chassis":"#0C0C0D","display":"#000000","displayInk":"#FF7A3D","ink":"#E9E4E0","primary":"#FF7A3D"}
]);
import {customPalette} from './custom-theme.js';
export const themeIds=Object.freeze([...themes.map(theme=>theme.id),'custom']);
export const themeId=value=>themeIds.includes(value)?value:'graphite';
export function cachedTheme(){try{return themeId(globalThis.localStorage?.getItem('lifeos.theme'));}catch{return 'graphite';}}
export function cachedCustomTheme(){try{return JSON.parse(globalThis.localStorage?.getItem('lifeos.customTheme')||'null');}catch{return null;}}
const overrides=['chassis','plate','seam','display','display-ink','display-dim','display-meta','ink','dim','faint','key','key-hi','key-lo','key-ink','primary','primary-ink','blue','recess'];
export function applyTheme(value,root=globalThis.document?.documentElement,custom=cachedCustomTheme(),{persist=true}={}){
 let id=themeId(value),palette=themes.find(theme=>theme.id===id);
 if(id==='custom'){try{palette=customPalette(custom);}catch{id='graphite';palette=themes[0];}}
 if(root){root.dataset.theme=id;root.dataset.baseTheme=palette.base||id;for(const key of overrides)root.style?.removeProperty('--'+key);
  if(id==='custom'){
   const vars={chassis:palette.chassis,plate:palette.chassis,seam:`color-mix(in srgb,${palette.ink} 24%,${palette.chassis})`,display:palette.display,'display-ink':palette.displayInk,'display-dim':palette.displayInk,'display-meta':palette.displayInk,ink:palette.ink,dim:palette.ink,faint:palette.ink,key:`color-mix(in srgb,${palette.ink} 9%,${palette.chassis})`,'key-hi':`color-mix(in srgb,${palette.ink} 18%,${palette.chassis})`,'key-lo':palette.chassis,'key-ink':palette.ink,primary:palette.primary,'primary-ink':palette.primaryInk,blue:palette.primary,recess:palette.chassis};
   for(const [key,color]of Object.entries(vars))root.style?.setProperty('--'+key,color);
  }
 }
 const doc=root?.ownerDocument||(root===globalThis.document?.documentElement?globalThis.document:null);
 if(doc){doc.querySelector('meta[name="theme-color"]')?.setAttribute('content',palette.chassis);if(persist)try{globalThis.localStorage?.setItem('lifeos.theme',id);if(custom)globalThis.localStorage?.setItem('lifeos.customTheme',JSON.stringify(custom));else globalThis.localStorage?.removeItem('lifeos.customTheme');}catch{}}
 return id;
}

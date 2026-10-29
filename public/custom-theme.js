import {themes} from './themes.js';
const keys=['base','name','primary','display','chassis'];
export function validateCustomTheme(value){
 if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(key=>!keys.includes(key)))throw Error('Choose a valid custom theme.');
 if(!themes.some(theme=>theme.id===value.base))throw Error('Choose a base theme.');
 if(typeof value.name!=='string'||!value.name.trim()||value.name.length>40)throw Error('Use a theme name from 1 to 40 characters.');
 for(const key of ['primary','display','chassis'])if(typeof value[key]!=='string'||!/^#[\da-f]{6}$/i.test(value[key]))throw Error('Use a six-digit colour.');
 return {base:value.base,name:value.name.trim(),primary:value.primary,display:value.display,chassis:value.chassis};
}
const luminance=hex=>hex.slice(1).match(/../g).map(v=>parseInt(v,16)/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4).reduce((sum,v,i)=>sum+v*[.2126,.7152,.0722][i],0);
export function contrastRatio(a,b){const x=luminance(a),y=luminance(b);return(Math.max(x,y)+.05)/(Math.min(x,y)+.05);}
const readable=(ink,bg)=>contrastRatio(ink,bg)>=4.5?ink:contrastRatio('#000000',bg)>contrastRatio('#ffffff',bg)?'#000000':'#ffffff';
const blend=(a,b,k)=>'#'+a.slice(1).match(/../g).map((v,i)=>Math.round(parseInt(v,16)*(1-k)+parseInt(b.slice(1+i*2,3+i*2),16)*k).toString(16).padStart(2,'0')).join('');
export function customPalette(value){const custom=validateCustomTheme(value),base=themes.find(t=>t.id===custom.base),ink=readable(base.ink,custom.chassis),away=contrastRatio(ink,'#ffffff')>contrastRatio(ink,'#000000')?'#ffffff':'#000000';return {...base,...custom,id:'custom',ink,displayInk:readable(base.displayInk,custom.display),primaryInk:readable(base.chassis,custom.primary),key:blend(custom.chassis,away,.09),linkInk:readable(custom.primary,custom.chassis)};}

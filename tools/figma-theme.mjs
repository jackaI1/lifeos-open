#!/usr/bin/env node
// Turns three named colour styles in a Figma file into a LifeOS custom theme.
// Usage:
//   node tools/figma-theme.mjs --file design.json [--base midnight] [--name "My theme"] [--out theme.json]
//   FIGMA_TOKEN=... node tools/figma-theme.mjs --key <file key> [--base ...] [--name ...]
import {readFile,writeFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {validateCustomTheme} from '../public/custom-theme.js';

// Figma "Fill" styles whose names the importer looks for, mapped to theme fields.
export const figmaStyleNames=Object.freeze({primary:'Theme/Primary',display:'Theme/Display',chassis:'Theme/Chassis'});

const channelHex=value=>Math.round(value*255).toString(16).padStart(2,'0');

// Figma stores colours as red, green, blue and alpha numbers from 0 to 1.
export function figmaColourToHex(color){
 if(!color||['r','g','b'].some(key=>typeof color[key]!=='number'||color[key]<0||color[key]>1))throw Error('Figma colour needs red, green and blue values from 0 to 1.');
 if(color.a!==undefined&&color.a!==1)throw Error('Use an opaque Figma colour; transparent fills cannot be a LifeOS theme colour.');
 return ('#'+channelHex(color.r)+channelHex(color.g)+channelHex(color.b)).toUpperCase();
}

// Figma lists the style id on each shape that uses it, under node.styles.fill.
function findStyledNode(node,styleId){
 if(!node||typeof node!=='object')return null;
 if(node.styles?.fill===styleId)return node;
 for(const child of node.children??[]){const found=findStyledNode(child,styleId);if(found)return found;}
 return null;
}

export function themeFromFigmaFile(file,{base='midnight',name='Figma'}={}){
 const styles=file?.styles??{},colours={},missing=[];
 for(const [field,styleName] of Object.entries(figmaStyleNames)){
  const styleId=Object.keys(styles).find(id=>styles[id]?.styleType==='FILL'&&styles[id].name===styleName);
  if(!styleId){missing.push(styleName);continue;}
  const node=findStyledNode(file.document,styleId);
  if(!node)throw Error(`No shape in the Figma file uses the style ${styleName}.`);
  const fill=(node.fills??[]).find(item=>item.visible!==false&&item.type==='SOLID');
  if(!fill)throw Error(`${styleName} has no solid fill.`);
  if((fill.opacity??1)!==1)throw Error(`${styleName} is see-through; use a fully opaque colour.`);
  colours[field]=figmaColourToHex(fill.color);
 }
 if(missing.length)throw Error(`Missing Figma colour styles: ${missing.join(', ')}. Create each one as a Fill style in the file.`);
 return validateCustomTheme({base,name,...colours});
}

// Reads one file through the Figma REST API. The token is sent only as a header.
export async function fetchFigmaFile(fileKey,token,fetchImpl=fetch){
 if(!token)throw Error('Set FIGMA_TOKEN to a Figma personal access token before fetching a file.');
 if(!/^[A-Za-z0-9]+$/.test(fileKey))throw Error('The Figma file key should contain letters and numbers only.');
 const response=await fetchImpl(`https://api.figma.com/v1/files/${fileKey}`,{headers:{'X-Figma-Token':token}});
 if(!response.ok)throw Error(`Figma returned HTTP ${response.status}. Check the file key and token.`);
 return response.json();
}

function parseArgs(argv){
 const options={};
 for(let i=0;i<argv.length;i+=2){
  const flag=argv[i],value=argv[i+1];
  if(!['--file','--key','--base','--name','--out'].includes(flag)||value===undefined)throw Error(`Unknown or incomplete option: ${flag}`);
  options[flag.slice(2)]=value;
 }
 if(Boolean(options.file)===Boolean(options.key))throw Error('Give exactly one of --file or --key.');
 return options;
}

async function main(argv){
 const options=parseArgs(argv);
 const file=options.file?JSON.parse(await readFile(options.file,'utf8')):await fetchFigmaFile(options.key,process.env.FIGMA_TOKEN);
 const theme=themeFromFigmaFile(file,{base:options.base,name:options.name??file.name??'Figma'});
 const json=JSON.stringify(theme,null,1)+'\n';
 if(options.out)await writeFile(options.out,json);
 else process.stdout.write(json);
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 main(process.argv.slice(2)).catch(error=>{console.error(error.message);process.exitCode=1;});
}

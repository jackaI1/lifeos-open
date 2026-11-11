import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {fileURLToPath} from 'node:url';
import {validateCustomTheme,customPalette,contrastRatio} from '../public/custom-theme.js';
import {themeFromFigmaFile,fetchFigmaFile,figmaColourToHex} from '../tools/figma-theme.mjs';

const fixturePath=fileURLToPath(new URL('./fixtures/figma-theme-file.json',import.meta.url));
const sample=JSON.parse(await readFile(fixturePath,'utf8'));
const expected={base:'midnight',name:'Figma sample',primary:'#F2B21B',display:'#1C2022',chassis:'#E4E3DF'};
const copy=()=>structuredClone(sample);

test('Figma colour styles become a valid LifeOS custom theme',()=>{
 const theme=themeFromFigmaFile(copy(),{base:'midnight',name:'Figma sample'});
 assert.deepEqual(theme,expected);
 assert.deepEqual(validateCustomTheme(theme),expected);
 const palette=customPalette(theme);
 assert.ok(contrastRatio(palette.ink,palette.chassis)>=4.5);
});

test('channel values from 0 to 1 convert to six-digit hex',()=>{
 assert.equal(figmaColourToHex({r:0,g:0,b:0}),'#000000');
 assert.equal(figmaColourToHex({r:1,g:1,b:1,a:1}),'#FFFFFF');
 assert.equal(figmaColourToHex({r:0.5,g:0.5,b:0.5}),'#808080');
 assert.throws(()=>figmaColourToHex({r:1.2,g:0,b:0}),/from 0 to 1/);
 assert.throws(()=>figmaColourToHex({r:0,g:0,b:0,a:0.5}),/opaque/);
});

test('a missing Figma style names every style that is absent',()=>{
 const file=copy();
 delete file.styles['5:2'];
 delete file.styles['5:3'];
 assert.throws(()=>themeFromFigmaFile(file,{base:'midnight',name:'x'}),/Theme\/Display, Theme\/Chassis/);
});

test('a style that no shape uses is reported, not guessed', ()=>{
 const file=copy();
 file.document.children[0].children[1].styles={};
 assert.throws(()=>themeFromFigmaFile(file,{base:'midnight',name:'x'}),/No shape in the Figma file uses the style Theme\/Display/);
});

test('hidden, gradient and see-through fills are refused',()=>{
 const hidden=copy();hidden.document.children[0].children[0].fills[0].visible=false;
 assert.throws(()=>themeFromFigmaFile(hidden,{base:'midnight',name:'x'}),/no solid fill/);
 const faded=copy();faded.document.children[0].children[0].fills[0].opacity=0.5;
 assert.throws(()=>themeFromFigmaFile(faded,{base:'midnight',name:'x'}),/see-through/);
 const gradient=copy();gradient.document.children[0].children[0].fills=[{type:'GRADIENT_LINEAR'}];
 assert.throws(()=>themeFromFigmaFile(gradient,{base:'midnight',name:'x'}),/no solid fill/);
});

test('fetching a file sends the token as a header and never echoes it',async()=>{
 const calls=[];
 const fakeFetch=async(url,init)=>{calls.push({url,init});return new Response(JSON.stringify(copy()),{status:200});};
 const file=await fetchFigmaFile('AbC123',"fixture-token",fakeFetch);
 assert.equal(calls[0].url,'https://api.figma.com/v1/files/AbC123');
 assert.equal(calls[0].init.headers['X-Figma-Token'],'fixture-token');
 assert.equal(file.name,'LifeOS colour sample');
});

test('fetch errors name the status but never the token',async()=>{
 const denied=async()=>new Response('nope',{status:403});
 await assert.rejects(fetchFigmaFile('AbC123','fixture-token',denied),err=>/HTTP 403/.test(err.message)&&!err.message.includes('fixture-token'));
 await assert.rejects(fetchFigmaFile('AbC123',''),/FIGMA_TOKEN/);
 await assert.rejects(fetchFigmaFile('../etc',"fixture-token",denied),/letters and numbers/);
});

test('the command line writes the theme JSON from a saved file',async()=>{
 const script=fileURLToPath(new URL('../tools/figma-theme.mjs',import.meta.url));
 const {stdout}=await promisify(execFile)(process.execPath,[script,'--file',fixturePath,'--name','Figma sample']);
 assert.deepEqual(JSON.parse(stdout),expected);
});

test('the command line rejects ambiguous input', async()=>{
 const script=fileURLToPath(new URL('../tools/figma-theme.mjs',import.meta.url));
 await assert.rejects(promisify(execFile)(process.execPath,[script]),err=>/exactly one of --file or --key/.test(err.stderr));
});

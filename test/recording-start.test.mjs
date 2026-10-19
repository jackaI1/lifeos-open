import test from 'node:test';
import assert from 'node:assert/strict';
import {setImmediate as tick} from 'node:timers/promises';
import {LectureRecorder} from '../public/lecture-recorder.js';
test('lecture recording is ready only after its media start anchor exists',async()=>{
 class DelayedRecorder extends EventTarget{static instance;static isTypeSupported(){return true;}constructor(){super();DelayedRecorder.instance=this;this.mimeType='audio/webm';this.state='inactive';}start(){this.state='recording';}stop(){this.state='inactive';this.dispatchEvent(new Event('stop'));}}
 const rows=new Map(),clock={epochId:'synthetic-epoch',offset:()=>100,anchor:()=>({offsetMs:100,wallAt:'2026-10-19T10:35:00Z'}),eventOffset:()=>100};let settled=false;
 const recorder=new LectureRecorder({id:'synthetic-lecture',clock,store:{async get(k){return rows.get(k);},async put(k,v){rows.set(k,v);},async keys(){return[];}},request:async()=>{throw Error('No upload is expected for empty synthetic media');},mediaDevices:{async getUserMedia(){return{getTracks:()=>[{stop(){}}]};}},Recorder:DelayedRecorder,setTimer:()=>0,clearTimer(){}});
 const starting=recorder.start('approved-by-owner-confirmation').then(()=>{settled=true;});
 while(!DelayedRecorder.instance)await tick();await tick();
 try{assert.equal(settled,false,'start resolved before the media start event');assert.notEqual(recorder.state,'recording','UI announced recording without a timestamp anchor');DelayedRecorder.instance.dispatchEvent(new Event('start'));await starting;assert.equal(recorder.state,'recording');assert.equal(recorder.segmentForOffset(100),'0001');}finally{if(!settled){DelayedRecorder.instance.dispatchEvent(new Event('start'));await starting;}await recorder.pause();}
});

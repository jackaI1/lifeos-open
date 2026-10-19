import {PrayerRecorder} from './recorder.js';

// Captured audio uploads directly to the cloud. Neither models nor laptop heartbeats gate it.
export class PrayerRecovery {
  constructor({store,request,action,changed=()=>{},isVisible=()=>!globalThis.document?.hidden,setTimer=(fn,ms)=>setTimeout(fn,ms),clearTimer=id=>clearTimeout(id)}) {
    Object.assign(this,{store,changed,isVisible,setTimer,clearTimer});
    this.recorder=new PrayerRecorder({store,request,action});
    this.timer=null;this.running=null;this.attempt=0;this.stopped=false;
  }
  kick(){
    this.clearTimer(this.timer);
    if(this.stopped||!this.isVisible())return Promise.resolve();
    if(this.running)return this.running;
    this.running=this.recover().finally(()=>{this.running=null;});
    return this.running;
  }
  async recover(){
    let pending=0;
    try{
      const sessions=(await this.store.list('recording:')).map(r=>r.value).filter(s=>s.state!=='uploaded'&&s.endedAt&&s.chunks>0);
      for(const session of sessions.slice(0,5)){
        try{const result=await this.recorder.recover(session);if(result?.pending)pending++;}catch{pending++;}
      }
      pending+=Math.max(0,sessions.length-5);
      this.changed({pending});
    }catch{pending=1;}
    if(pending&&!this.stopped&&this.isVisible()){
      const delay=[5000,15000,60000,180000,300000][Math.min(this.attempt++,4)];
      this.timer=this.setTimer(()=>{void this.kick();},delay);
    }else this.attempt=0;
  }
  stop(){this.stopped=true;this.clearTimer(this.timer);}
}

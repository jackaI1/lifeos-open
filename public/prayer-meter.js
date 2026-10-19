export function microphoneAmplitude(bytes){if(!bytes.length)return 0;let sum=0;for(const value of bytes){const x=(value-128)/128;sum+=x*x;}return Math.min(1,Math.sqrt(sum/bytes.length)*4);}
export function startMicrophoneMeter(stream,onLevel,onAvailable=()=>{}){
 const Audio=globalThis.AudioContext??globalThis.webkitAudioContext;if(!Audio||!stream){onAvailable(false);return()=>{};}
 let audio,frame,stopped=false,source,analyser,mute;
 const resume=()=>{if(!stopped&&audio.state!=='running')void audio.resume().catch(()=>onAvailable(false));};
 const tick=()=>{if(stopped)return;onAvailable(audio.state==='running');if(!document.hidden&&audio.state==='running'){analyser.getByteTimeDomainData(bytes);onLevel(microphoneAmplitude(bytes));}frame=requestAnimationFrame(tick);};
 const bytes=new Uint8Array(1024);
 const stop=()=>{stopped=true;cancelAnimationFrame(frame);document.removeEventListener('pointerdown',resume);document.removeEventListener('visibilitychange',resume);source?.disconnect();analyser?.disconnect();mute?.disconnect();void audio?.close().catch(()=>{});onLevel(0);onAvailable(false);};
 try{audio=new Audio();source=audio.createMediaStreamSource(stream);analyser=audio.createAnalyser();analyser.fftSize=bytes.length;mute=audio.createGain();mute.gain.value=0;source.connect(analyser);analyser.connect(mute);mute.connect(audio.destination);document.addEventListener('pointerdown',resume);document.addEventListener('visibilitychange',resume);resume();tick();return stop;}catch{stop();return()=>{};}
}

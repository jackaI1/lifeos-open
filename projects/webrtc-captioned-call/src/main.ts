import '@fontsource/source-sans-3/latin-400.css';
import '@fontsource/source-sans-3/latin-600.css';
import './style.css';
import { roomSchema, type ClientMessage, type ServerMessage } from './protocol';
import { parseCaption } from './caption-protocol';
import { LocalCaptions } from './captions';

const el = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const roomInput = el<HTMLInputElement>('room');
const localVideo = el<HTMLVideoElement>('local-video'), remoteVideo = el<HTMLVideoElement>('remote-video');
const joinButton = el<HTMLButtonElement>('join'), leaveButton = el<HTMLButtonElement>('leave');
const micButton = el<HTMLButtonElement>('mic'), cameraButton = el<HTMLButtonElement>('camera');
const captionButton = el<HTMLButtonElement>('captions');
const setText = (id: string, value: string) => { el(id).textContent = value; };
function error(message: string) { el('error').hidden = !message; setText('error',message); }
const errors: Record<string,string> = {
  'room-full':'This room already has two people. Choose a different code.',
  'server-full':'The signalling server is full. Try again later.',
  'rate-limit':'Too many connection messages. Join again in a minute.',
};
type Session = {
  pc: RTCPeerConnection; stream: MediaStream; ws?:WebSocket; channel?:RTCDataChannel;
  timer?:ReturnType<typeof setInterval>; captions?:LocalCaptions; pendingIce:RTCIceCandidateInit[];
  sequence:number; lastReceived:number; closed:boolean;
};
let active: Session | undefined;
let joining = false;
let pendingStream: MediaStream | undefined;
let pendingConfig: AbortController | undefined;
let generation = 0;
roomInput.value = new URL(location.href).searchParams.get('room') ?? crypto.randomUUID().replaceAll('-','').slice(0,12);
function send(session:Session, message:ClientMessage) {
  if (active === session && session.ws?.readyState === WebSocket.OPEN) session.ws.send(JSON.stringify(message));
}
function caption(text:string,speaker:'You'|'Partner') {
  const log = el('transcript'); log.querySelector('.transcript-empty')?.remove();
  const line = document.createElement('p'); line.dataset.speaker = speaker;
  const name = document.createElement('strong'); name.textContent = speaker;
  const words = document.createElement('span'); words.textContent = text;
  line.append(name,words); log.append(line);
  while (log.children.length > 50) log.firstElementChild?.remove();
  log.scrollTop = log.scrollHeight;
}
function wireChannel(session:Session, channel:RTCDataChannel) {
  if (channel.label !== 'captions' || session.channel) { channel.close(); return; }
  session.channel = channel;
  channel.onopen = () => { if (active === session) { setText('data-state','open'); captionButton.disabled = false; } };
  channel.onclose = () => { if (active === session) { setText('data-state','closed'); stopCaptions(session); captionButton.disabled = true; } };
  channel.onmessage = event => {
    const message = parseCaption(event.data);
    if (active !== session || !message || message.sequence <= session.lastReceived) return;
    session.lastReceived = message.sequence; caption(message.text,'Partner');
  };
}
function stopCaptions(session:Session) {
  session.captions?.stop(); session.captions = undefined;
  captionButton.textContent = 'Enable my captions'; setText('caption-state','Captions off');
}
function endCall(message = 'Call ended') {
  generation++; joining = false;
  pendingStream?.getTracks().forEach(track => track.stop()); pendingStream = undefined;
  pendingConfig?.abort(); pendingConfig = undefined;
  const session = active; active = undefined;
  if (session) {
    session.closed = true; stopCaptions(session); clearInterval(session.timer);
    session.channel?.close(); session.pc.close(); session.ws?.close();
    session.stream.getTracks().forEach(track => track.stop());
  }
  localVideo.srcObject = null; remoteVideo.srcObject = null;
  el('local-preview').hidden = true;
  el('stage-empty').hidden = false;
  joinButton.disabled = false; roomInput.disabled = false;
  for (const button of [micButton,cameraButton,leaveButton,captionButton]) button.disabled = true;
  micButton.textContent = 'Mute microphone'; cameraButton.textContent = 'Turn camera off';
  micButton.setAttribute('aria-pressed','false'); cameraButton.setAttribute('aria-pressed','false');
  setText('connection-state','closed'); setText('ice-state','closed'); setText('data-state','closed');
  setText('received-bytes','0'); setText('packets-lost','0'); setText('round-trip','Not measured');
  el('transcript').replaceChildren();
  const empty = document.createElement('p'); empty.className = 'transcript-empty';
  empty.textContent = 'Words will appear here when either person turns on their captions.';
  el('transcript').append(empty); setText('call-state',message);
}
async function signal(session:Session, message:ServerMessage) {
  if (active !== session) return;
  const pc = session.pc;
  if (message.type === 'error') {
    endCall('Could not join'); error(errors[message.code] ?? 'The connection could not be set up. Join again.');
  } else if (message.type === 'joined') setText('call-state','Waiting for your partner');
  else if (message.type === 'peer-left') endCall('Your partner left. Join again to start a new call.');
  else if (message.type === 'peer-ready') {
    setText('call-state','Connecting to your partner');
    if (message.initiator) {
      wireChannel(session, pc.createDataChannel('captions',{ordered:true}));
      await pc.setLocalDescription(await pc.createOffer());
      send(session,{type:'offer',sdp:pc.localDescription!.sdp});
    }
  } else if (message.type === 'offer' || message.type === 'answer') {
    await pc.setRemoteDescription({type:message.type,sdp:message.sdp});
    for (const candidate of session.pendingIce.splice(0)) await pc.addIceCandidate(candidate);
    if (message.type === 'offer') {
      await pc.setLocalDescription(await pc.createAnswer());
      send(session,{type:'answer',sdp:pc.localDescription!.sdp});
    }
  } else if (message.type === 'ice' && message.candidate) {
    if (pc.remoteDescription) await pc.addIceCandidate(message.candidate);
    else session.pendingIce.push(message.candidate);
  }
}
async function updateStats(session:Session) {
  if (active !== session) return;
  try {
    const stats = await session.pc.getStats();
    if (active !== session) return;
    let bytes = 0, lost = 0;
    stats.forEach(report => {
      if (report.type === 'inbound-rtp' && report.kind === 'video') { bytes += report.bytesReceived ?? 0; lost += report.packetsLost ?? 0; }
      if (report.type === 'candidate-pair' && report.state === 'succeeded' && report.nominated && report.currentRoundTripTime !== undefined) setText('round-trip',`${Math.round(report.currentRoundTripTime * 1000)} ms`);
    });
    setText('received-bytes',bytes.toLocaleString()); setText('packets-lost',String(lost));
  } catch { /* Connection may have closed while stats were in flight. */ }
}
el<HTMLFormElement>('join-form').addEventListener('submit', async event => {
  event.preventDefault(); if (joining || active) return;
  error('');
  const room = roomInput.value.trim();
  if (!roomSchema.safeParse(room).success) { error('Use 6 to 64 letters, numbers, hyphens or underscores for the room code.'); return; }
  if (!navigator.mediaDevices?.getUserMedia) { error('Open this page on localhost or HTTPS to use your camera and microphone.'); return; }
  joining = true; const version = ++generation;
  joinButton.disabled = true; roomInput.disabled = true; leaveButton.disabled = false;
  setText('call-state','Allow camera and microphone');
  let stream:MediaStream | undefined;
  try {
    stream = await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true,noiseSuppression:true},video:{width:{ideal:1280},height:{ideal:720}}});
    if (version !== generation) { stream.getTracks().forEach(track => track.stop()); return; }
    pendingStream = stream;
    pendingConfig = new AbortController();
    const response = await fetch('/config.json', {signal:AbortSignal.any([pendingConfig.signal,AbortSignal.timeout(10_000)])});
    if (!response.ok) throw new Error('Configuration unavailable');
    const config = await response.json();
    if (version !== generation) { stream.getTracks().forEach(track => track.stop()); return; }
    pendingStream = undefined; pendingConfig = undefined;
    const pc = new RTCPeerConnection({iceServers:config.iceServers});
    const session:Session = {pc,stream,pendingIce:[],sequence:0,lastReceived:-1,closed:false};
    active = session; joining = false;
    for (const track of stream.getTracks()) pc.addTrack(track,stream);
    localVideo.srcObject = stream; el('local-preview').hidden = false;
    for (const button of [micButton,cameraButton]) button.disabled = false;
    pc.ontrack = event => {
      if (active !== session) return;
      remoteVideo.srcObject = event.streams[0] ?? new MediaStream([event.track]);
      el('stage-empty').hidden = true;
      void remoteVideo.play().catch(() => error('Your browser blocked sound. Click your partner’s video to play it.'));
    };
    pc.ondatachannel = event => wireChannel(session,event.channel);
    pc.onicecandidate = event => send(session,{type:'ice',candidate:event.candidate ? {...event.candidate.toJSON(), candidate:event.candidate.candidate} : null});
    pc.oniceconnectionstatechange = () => { if (active === session) setText('ice-state',pc.iceConnectionState); };
    pc.onconnectionstatechange = () => {
      if (active !== session) return;
      setText('connection-state',pc.connectionState);
      if (pc.connectionState === 'connected') setText('call-state','You’re connected');
      if (pc.connectionState === 'disconnected') setText('call-state','Connection interrupted. Waiting for the network.');
      if (pc.connectionState === 'failed') { endCall('Connection failed'); error('Could not reach your partner. Join again, or check the HTTPS and relay setup for calls across networks.'); }
    };
    const ws = new WebSocket(`${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/signal`);
    session.ws = ws;
    let sequence = Promise.resolve();
    ws.onopen = () => send(session,{type:'join',room});
    ws.onmessage = event => {
      // Serialize async SDP operations so early ICE cannot overtake setRemoteDescription.
      sequence = sequence.then(() => signal(session,JSON.parse(event.data))).catch(() => {
        if (active === session) { endCall('Connection failed'); error('The call could not be negotiated. Join again.'); }
      });
    };
    ws.onclose = () => { if (active === session) { endCall('Signalling disconnected'); error('The connection server disconnected. Join again when it is available.'); } };
    ws.onerror = () => { if (active === session) { endCall('Signalling unavailable'); error('Could not reach the connection server. Check that it is running, then join again.'); } };
    session.timer = setInterval(() => void updateStats(session),1000);
    history.replaceState(null,'',`?room=${encodeURIComponent(room)}`);
  } catch (cause) {
    stream?.getTracks().forEach(track => track.stop());
    if (version !== generation) return;
    endCall('Could not join');
    error(cause instanceof DOMException && cause.name === 'NotAllowedError'
      ? 'Allow camera and microphone in your browser settings, then join again.'
      : 'Could not start your camera or microphone. Check your devices and the connection server, then join again.');
  }
});
leaveButton.onclick = () => endCall();
micButton.onclick = () => {
  const track = active?.stream.getAudioTracks()[0]; if (!track) return;
  track.enabled = !track.enabled; micButton.textContent = track.enabled ? 'Mute microphone' : 'Unmute microphone';
  micButton.setAttribute('aria-pressed',String(!track.enabled));
};
cameraButton.onclick = () => {
  const track = active?.stream.getVideoTracks()[0]; if (!track) return;
  track.enabled = !track.enabled; cameraButton.textContent = track.enabled ? 'Turn camera off' : 'Turn camera on';
  cameraButton.setAttribute('aria-pressed',String(!track.enabled));
};
captionButton.onclick = () => {
  const session = active; if (!session) return;
  if (session.captions) { stopCaptions(session); return; }
  error(''); captionButton.textContent = 'Disable my captions';
  session.captions = new LocalCaptions(session.stream, text => {
    if (active !== session || session.channel?.readyState !== 'open') return;
    if (session.channel.bufferedAmount > 64 * 1024) { setText('caption-state','Caption channel busy. Skipping delayed text.'); return; }
    session.channel.send(JSON.stringify({type:'caption',version:1,sequence:session.sequence++,text}));
    caption(text,'You');
  }, status => { if (active === session) setText('caption-state',status); }, () => {
    if (active !== session) return;
    stopCaptions(session); error('Could not start local captions. Run npm run setup:models on the host, reload, and enable captions again.');
  });
};
el('copy').onclick = async () => {
  const url = new URL(location.href); url.searchParams.set('room',roomInput.value.trim());
  try { await navigator.clipboard.writeText(url.toString()); setText('copy-status','Invite link copied'); }
  catch { setText('copy-status','Copy the room code and share it with your partner.'); }
};
remoteVideo.onclick = () => void remoteVideo.play();
window.addEventListener('pagehide',() => endCall());

import { downsample, hasSpeech } from './audio';

export class LocalCaptions {
  private worker: Worker;
  private context?: AudioContext;
  private source?: MediaStreamAudioSourceNode;
  private node?: AudioWorkletNode;
  private stopped = false;
  private busy = false;
  constructor(
    private stream: MediaStream,
    private onText: (text:string) => void,
    private onStatus: (status:string) => void,
    private onError: () => void,
  ) {
    onStatus('Loading local Whisper');
    this.worker = new Worker(new URL('./whisper.worker.ts',import.meta.url), {type:'module'});
    this.worker.onmessage = event => {
      if (this.stopped) return;
      if (event.data.type === 'ready') void this.capture();
      else if (event.data.type === 'caption') {
        this.busy = false; onStatus('Listening');
        if (event.data.text) onText(event.data.text);
      } else if (event.data.type === 'error') this.fail();
    };
    this.worker.onerror = event => { console.error('Caption worker:',event.message); this.fail(); };
    this.worker.postMessage({type:'init'});
  }
  private fail() {
    if (this.stopped) return;
    this.stop(); this.onError();
  }
  private async capture() {
    try {
      this.context = new AudioContext({sampleRate:16000});
      await this.context.resume();
      await this.context.audioWorklet.addModule('/capture-processor.js');
      if (this.stopped) return;
      this.source = this.context.createMediaStreamSource(this.stream);
      this.node = new AudioWorkletNode(this.context,'caption-capture');
      this.node.port.onmessage = (event: MessageEvent<Float32Array>) => {
        if (this.stopped || this.busy) return; // Drop stale chunks, never queue audio behind slow inference.
        const audio = downsample(event.data,this.context!.sampleRate);
        if (!hasSpeech(audio)) return;
        this.busy = true; this.onStatus('Transcribing');
        this.worker.postMessage({type:'audio',audio},[audio.buffer]);
      };
      this.source.connect(this.node);
      // The processor outputs silence, so this keeps it running without microphone feedback.
      this.node.connect(this.context.destination);
      this.onStatus('Listening');
    } catch { this.fail(); }
  }
  stop() {
    if (this.stopped) return;
    this.stopped = true; this.worker.terminate();
    this.node?.disconnect(); this.source?.disconnect();
    if (this.node) this.node.port.close();
    void this.context?.close().catch(() => {});
  }
}

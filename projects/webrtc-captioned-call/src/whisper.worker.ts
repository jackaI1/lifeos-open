import { env, pipeline } from '@huggingface/transformers';

env.allowRemoteModels = false;
env.allowLocalModels = true;
env.localModelPath = '/models/';
env.backends.onnx.wasm!.wasmPaths = '/wasm/';
env.backends.onnx.wasm!.numThreads = 1;
let transcriber: Awaited<ReturnType<typeof pipeline<'automatic-speech-recognition'>>> | undefined;
let busy = false;
self.onmessage = async (event: MessageEvent<{type:'init' | 'audio'; audio?:Float32Array}>) => {
  if (busy) return;
  busy = true;
  try {
    if (event.data.type === 'init') {
      transcriber = await pipeline('automatic-speech-recognition', 'onnx-community/whisper-tiny.en', {
        device: 'wasm', dtype: 'q8',
      });
      self.postMessage({type:'ready'});
    } else if (transcriber && event.data.audio) {
      const output = await transcriber(event.data.audio, { max_new_tokens: 96 });
      const result = Array.isArray(output) ? output[0] : output;
      self.postMessage({type:'caption',text:result.text.trim().slice(0,512)});
    }
  } catch (error) {
    console.error('Whisper worker:', error instanceof Error ? error.message : String(error));
    self.postMessage({type:'error'});
  } finally { busy = false; }
};

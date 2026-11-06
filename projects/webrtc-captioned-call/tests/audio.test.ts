import { describe, it, expect } from 'vitest';
import { downsample, hasSpeech } from '../src/audio';
import { parseCaption } from '../src/caption-protocol';
describe('audio processing', () => {
  it('averages native audio into 16 kHz samples without changing duration', () => {
    expect([...downsample(new Float32Array([1, 2, 3, 4, 5, 6]), 48000)]).toEqual([2, 5]);
    expect(downsample(new Float32Array(44100), 44100)).toHaveLength(16000);
  });
  it('preserves 16 kHz and rejects unsupported rates', () => {
    const audio = new Float32Array([.2, .3]); expect(downsample(audio, 16000)).toEqual(audio);
    expect(() => downsample(audio, 0)).toThrow();
  });
  it('skips silence to avoid Whisper hallucinations', () => {
    expect(hasSpeech(new Float32Array(16000))).toBe(false);
    expect(hasSpeech(new Float32Array(16000).fill(.1))).toBe(true);
  });
});
describe('caption data channel protocol', () => {
  it('accepts a versioned caption with a bounded sequence and text', () => {
    expect(parseCaption(JSON.stringify({type:'caption',version:1,sequence:1,text:'Hello there'}))).toEqual({type:'caption',version:1,sequence:1,text:'Hello there'});
  });
  it.each(['oops', '{}', JSON.stringify({type:'caption',version:1,sequence:-1,text:'hi'}), JSON.stringify({type:'caption',version:1,sequence:1,text:'x'.repeat(513)})])('ignores malformed captions %s', raw => {
    expect(parseCaption(raw)).toBeNull();
  });
});

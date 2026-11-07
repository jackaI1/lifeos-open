export function downsample(audio: Float32Array, sampleRate: number): Float32Array {
  if (!Number.isFinite(sampleRate) || sampleRate < 16000) throw new Error('Audio must be at least 16 kHz');
  if (sampleRate === 16000) return audio;
  const ratio = sampleRate / 16000;
  const result = new Float32Array(Math.floor(audio.length / ratio));
  for (let i = 0; i < result.length; i++) {
    const start = Math.floor(i * ratio), end = Math.floor((i + 1) * ratio);
    let sum = 0;
    for (let j = start; j < end; j++) sum += audio[j];
    result[i] = sum / (end - start);
  }
  return result;
}
export function hasSpeech(audio: Float32Array): boolean {
  if (!audio.length) return false;
  let energy = 0;
  for (const value of audio) energy += value * value;
  return Math.sqrt(energy / audio.length) > .008;
}

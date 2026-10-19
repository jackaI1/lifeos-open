const rgb = color => [1, 3, 5].map(i => parseInt(color.slice(i, i + 2), 16));
const hex = values => '#' + values.map(v => Math.round(v).toString(16).padStart(2, '0')).join('');
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export function sampleColor({data, width, height}, x, y) {
  const px = clamp(Math.round(x * (width - 1)), 0, width - 1), py = clamp(Math.round(y * (height - 1)), 0, height - 1);
  const channels = [[], [], []];
  for (let yy = Math.max(0, py - 1); yy <= Math.min(height - 1, py + 1); yy++) for (let xx = Math.max(0, px - 1); xx <= Math.min(width - 1, px + 1); xx++) for (let c = 0; c < 3; c++) channels[c].push(data[(yy * width + xx) * 4 + c]);
  return hex(channels.map(a => a.sort((a, b) => a - b)[Math.floor(a.length / 2)]));
}
export function suggestBackground({data, width, height}) {
  // Dominant colour across the picture, not a presumed pure-white corner.
  const bins = new Map(), step = Math.max(1, Math.floor(Math.sqrt(width * height / 6000)));
  for (let y = 0; y < height; y += step) for (let x = 0; x < width; x += step) {
    const i = (y * width + x) * 4; if (data[i + 3] < 128) continue;
    const color = [data[i], data[i + 1], data[i + 2]], key = color.map(v => Math.floor(v / 24)).join(',');
    const bin = bins.get(key) ?? {colors: [], weight: 0}; bin.colors.push(color); bin.weight += 1; bins.set(key, bin);
  }
  const chosen = [...bins.values()].sort((a, b) => b.weight - a.weight)[0];
  if (!chosen) return {color: '#ffffff', threshold: 18};
  const center = [0, 1, 2].map(c => chosen.colors.reduce((n, v) => n + v[c], 0) / chosen.colors.length);
  const distances = chosen.colors.map(v => Math.sqrt(v.reduce((n, value, c) => n + (value - center[c]) ** 2, 0) / 3)).sort((a, b) => a - b);
  return {color: hex(center), threshold: Math.round(clamp(distances[Math.floor(distances.length * .9)] + 12, 18, 42))};
}
export function keyPixels(source, {color, threshold}) {
  const background = rgb(color), data = new Uint8ClampedArray(source.data), inner = threshold * threshold * 3, outer = (threshold + 10) ** 2 * 3;
  for (let i = 0; i < data.length; i += 4) {
    const d = (data[i] - background[0]) ** 2 + (data[i + 1] - background[1]) ** 2 + (data[i + 2] - background[2]) ** 2;
    if (d <= inner) data[i + 3] = 0;
    else if (d < outer) { const t = (Math.sqrt(d / 3) - threshold) / 10; data[i + 3] = Math.round(data[i + 3] * t * t * (3 - 2 * t)); }
  }
  return {data, width: source.width, height: source.height};
}
export function imagePixels(image) {
  const canvas = document.createElement('canvas'); canvas.width = image.naturalWidth || image.width; canvas.height = image.naturalHeight || image.height;
  const context = canvas.getContext('2d', {willReadFrequently: true}); context.drawImage(image, 0, 0); return context.getImageData(0, 0, canvas.width, canvas.height);
}
// Bounded cache, no work on an unchanged ink frame. The source JPEG is never replaced.
export class BackgroundImageCache {
  constructor() { this.entries = new Map(); this.bytes = 0; }
  get(image, keying) {
    if (!keying) return image;
    const key = image.src + '|' + keying.color + '|' + keying.threshold, cached = this.entries.get(key);
    if (cached) { this.entries.delete(key); this.entries.set(key, cached); return cached; }
    const pixels = keyPixels(imagePixels(image), keying), canvas = document.createElement('canvas'); canvas.width = pixels.width; canvas.height = pixels.height;
    canvas.getContext('2d').putImageData(new ImageData(pixels.data, pixels.width, pixels.height), 0, 0);
    const size = pixels.data.byteLength;
    while (this.entries.size && this.bytes + size > 48 * 1024 * 1024) { const oldest = this.entries.keys().next().value, item = this.entries.get(oldest); this.bytes -= item.width * item.height * 4; this.entries.delete(oldest); }
    this.entries.set(key, canvas); this.bytes += size; return canvas;
  }
  clear() { this.entries.clear(); this.bytes = 0; }
}

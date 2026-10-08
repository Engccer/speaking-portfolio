export function mergeTracks(tracks, sampleRate, gapSec = 0.5) {
  const gap = Math.round(gapSec * sampleRate);
  const total = tracks.reduce((s, t) => s + t.length, 0) + gap * Math.max(0, tracks.length - 1);
  const samples = new Float32Array(total);
  const offsets = [];
  let pos = 0;
  tracks.forEach((t, i) => {
    if (i > 0) pos += gap;
    samples.set(t, pos);
    offsets.push({ start: pos / sampleRate, end: (pos + t.length) / sampleRate });
    pos += t.length;
  });
  return { samples, offsets };
}

export function encodeWav(samples, sampleRate) {
  const buf = new ArrayBuffer(44 + samples.length * 2);
  const v = new DataView(buf);
  const str = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  str(0, "RIFF"); v.setUint32(4, 36 + samples.length * 2, true); str(8, "WAVE");
  str(12, "fmt "); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, sampleRate, true); v.setUint32(28, sampleRate * 2, true);
  v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  str(36, "data"); v.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    v.setInt16(44 + i * 2, s < 0 ? s * 32768 : s * 32767, true);
  }
  return buf;
}

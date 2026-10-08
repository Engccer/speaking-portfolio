import { test } from "node:test";
import assert from "node:assert/strict";
import { mergeTracks, encodeWav } from "../../lib/wav.js";

test("mergeTracks inserts gaps and reports offsets", () => {
  const sr = 16000;
  const t1 = new Float32Array(sr).fill(0.5);      // 1.0s
  const t2 = new Float32Array(sr / 2).fill(-0.5); // 0.5s
  const { samples, offsets } = mergeTracks([t1, t2], sr, 0.5);
  assert.equal(samples.length, sr + sr / 2 + sr / 2); // 1.0 + gap 0.5 + 0.5
  assert.deepEqual(offsets, [{ start: 0, end: 1 }, { start: 1.5, end: 2 }]);
  assert.equal(samples[sr + 10], 0); // gap is silence
});

test("encodeWav writes a valid 16-bit mono header", () => {
  const sr = 16000;
  const buf = encodeWav(new Float32Array([0, 1, -1, 0.5]), sr);
  const v = new DataView(buf);
  const tag = (o) => String.fromCharCode(v.getUint8(o), v.getUint8(o + 1), v.getUint8(o + 2), v.getUint8(o + 3));
  assert.equal(tag(0), "RIFF"); assert.equal(tag(8), "WAVE"); assert.equal(tag(36), "data");
  assert.equal(v.getUint16(22, true), 1);      // channels
  assert.equal(v.getUint32(24, true), sr);     // sample rate
  assert.equal(v.getUint16(34, true), 16);     // bits
  assert.equal(v.getUint32(40, true), 8);      // data bytes = 4 samples * 2
  assert.equal(v.getInt16(46, true), 32767);   // sample 1 clipped max
  assert.equal(v.getInt16(48, true), -32768);  // sample -1
});

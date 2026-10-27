import test from 'node:test';
import assert from 'node:assert/strict';
import { decodeAudioFrame } from '../src/audio-protocol.ts';
import { parseLayout } from '../src/layout.ts';

function packet() {
  const buffer = new ArrayBuffer(16 + (4096 + 8192) * 4);
  const header = new DataView(buffer);
  [0x41495553, 48000, 4096, 8192].forEach((value, index) => header.setUint32(index * 4, value, true));
  new Float32Array(buffer, 16, 4096).fill(-95);
  new Float32Array(buffer, 16 + 4096 * 4, 8192).fill(.25);
  return buffer;
}
test('host audio frames preserve FFT bins, waveform and sample rate without an AudioContext', () => {
  const frame = decodeAudioFrame(packet());
  assert.equal(frame.sampleRate, 48000);
  assert.equal(frame.frequency.length, 4096);
  assert.equal(frame.waveform.length, 8192);
  assert.equal(frame.frequency[0], -95);
  assert.equal(frame.waveform[0], .25);
});
test('truncated, oversized, unsupported and non-finite audio frames are rejected', () => {
  assert.equal(decodeAudioFrame(new ArrayBuffer(8)), null);
  assert.equal(decodeAudioFrame(packet().slice(0, -4)), null);
  for (const [offset, value] of [[0, 0], [4, 0], [8, 2048], [12, 16384]]) {
    const buffer = packet(); new DataView(buffer).setUint32(offset, value, true);
    assert.equal(decodeAudioFrame(buffer), null);
  }
  for (const offset of [16, 16 + 4096 * 4]) {
    const buffer = packet(); new DataView(buffer).setFloat32(offset, NaN, true);
    assert.equal(decodeAudioFrame(buffer), null);
  }
});

const ids = ['one', 'two'];
const rect = { x: .1, y: .2, width: .3, height: .4, angle: 25, inverted: false };
const layout = () => ({ order: ['two', 'one'], windows: { one: { ...rect }, two: { ...rect, inverted: true } } });
test('shared layouts preserve normalized geometry, stacking order and inversion', () => {
  assert.deepEqual(parseLayout(layout(), ids), layout());
});
test('corrupt layouts cannot inject unknown panels or invalid geometry into an OBS page', () => {
  assert.equal(parseLayout(null, ids), null);
  assert.equal(parseLayout({ ...layout(), order: ['one', 'one'] }, ids), null);
  assert.equal(parseLayout({ ...layout(), order: ['one', 'unknown'] }, ids), null);
  const missing = layout(); delete missing.windows.two;
  assert.equal(parseLayout(missing, ids), null);
  for (const change of [{ width: 0 }, { height: Infinity }, { x: NaN }, { angle: 999 }, { inverted: 'true' }]) {
    const bad = layout(); Object.assign(bad.windows.one, change);
    assert.equal(parseLayout(bad, ids), null);
  }
});

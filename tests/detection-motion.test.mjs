import test from 'node:test';
import assert from 'node:assert/strict';
import { DETECTION_CLASSES, DetectionMotion } from '../src/detection-motion.ts';

function random(seed) { return () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; }; }

test('confidence varies gently while the effect exposes no animated geometry', () => {
  const motion = new DetectionMotion('STREAMING', .79, 0, random(17));
  const values = new Set();
  for (let time = 0; time < 2400; time += 160) {
    const frame = motion.sample(time);
    assert.equal(frame.label, 'STREAMING');
    assert.deepEqual(Object.keys(frame).sort(), ['confidence', 'label']);
    assert.ok(Math.abs(frame.confidence - .79) <= .030001);
    values.add(frame.confidence.toFixed(2));
  }
  assert.ok(values.size >= 3);
});

test('panels stay stationary through every former jitter interval', () => {
  const motion = new DetectionMotion('CHAT', .64, 0, random(21));
  for (let time = 0; time < 120000; time += 80) {
    assert.deepEqual(Object.keys(motion.sample(time)).sort(), ['confidence', 'label']);
  }
});

test('large confidence excursions are bounded and recover to normal tracking', () => {
  const motion = new DetectionMotion('STREAMING', .79, 0, random(43));
  let jump = -1;
  for (let time = 0; time < 15000; time += 80) {
    const frame = motion.sample(time);
    assert.ok(frame.confidence >= .02 && frame.confidence <= .99);
    if (Math.abs(frame.confidence - .79) > .15) { jump = time; break; }
  }
  assert.ok(jump >= 5000);
  const recovered = motion.sample(jump + 1800);
  assert.ok(Math.abs(recovered.confidence - .79) <= .030001);
});
test('classification mistakes use the alternate words and then restore the original class', () => {
  const motion = new DetectionMotion('CHAT', .64, 0, random(61));
  let changed = -1, restored = -1;
  for (let time = 0; time < 15000; time += 80) {
    const frame = motion.sample(time);
    if (frame.label !== 'CHAT') { assert.ok(DETECTION_CLASSES.includes(frame.label)); if (changed < 0) changed = time; }
    else if (changed >= 0) { restored = time; break; }
  }
  assert.ok(changed >= 4500 && restored > changed && restored - changed < 1200);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { sampleOnAir, ON_AIR_CYCLE } from '../src/on-air-motion.ts';

test('N AIR sweeps its full weight range from 150 to 850 and repeats on the original cycle', () => {
  assert.equal(sampleOnAir(6900).weight, 150);
  assert.equal(sampleOnAir(2900).weight, 850);
  for (let time = 0; time <= ON_AIR_CYCLE; time += 100) {
    const frame = sampleOnAir(time);
    assert.ok(frame.weight >= 150 && frame.weight <= 850);
    assert.ok(frame.width >= 70 && frame.width <= 135);
    assert.ok(Math.abs(frame.weight - sampleOnAir(time + ON_AIR_CYCLE).weight) < 1e-9);
  }
});

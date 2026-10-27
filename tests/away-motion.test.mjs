import test from 'node:test';
import assert from 'node:assert/strict';
import { AwayMotion, AWAY_DEFAULTS, AWAY_TIMING, AWAY_GEOMETRY, awayMessages } from '../src/away-motion.ts';

test('away messages preserve one or two paragraphs in order and omit an empty second slot', () => {
  assert.deepEqual(awayMessages({ text1: ' BRB 暂离 ', text2: '   ' }), ['BRB 暂离']);
  assert.deepEqual(awayMessages({ text1: '先显示第一段', text2: 'Then the second' }), ['先显示第一段', 'Then the second']);
  assert.equal(AWAY_DEFAULTS.overlayOpacity, .5);
  assert.ok(AWAY_GEOMETRY.glyphHeight > 115 && AWAY_GEOMETRY.glyphHeight <= AWAY_GEOMETRY.bandHeight * .6);
});

test('the center line fills the full width before expanding and revealing the ticker', () => {
  const motion = new AwayMotion(); motion.setEnabled(true);
  assert.equal(motion.read().phase, 'line-in');
  let state = motion.advance(AWAY_TIMING.line / 2);
  assert.ok(Math.abs(state.width - .5) < 1e-8);
  assert.equal(state.expand, 0); assert.equal(state.text, 0);
  state = motion.advance(AWAY_TIMING.line / 2);
  assert.equal(state.width, 1); assert.equal(state.phase, 'expand');
  state = motion.advance(AWAY_TIMING.expand / 2);
  assert.ok(Math.abs(state.expand - .5) < 1e-8); assert.equal(state.text, 0);
  state = motion.advance(AWAY_TIMING.expand / 2 + AWAY_TIMING.text);
  assert.deepEqual(state, { width: 1, expand: 1, offset: 0, text: 1, mask: 1, phase: 'visible' });
  assert.equal(motion.running, false);
});

test('expansion and collapse have slow ends and a single fast middle without overshoot', () => {
  const motion = new AwayMotion(); motion.setEnabled(true); motion.advance(AWAY_TIMING.line);
  const values = [motion.read().expand];
  for (let i = 0; i < 10; i++) values.push(motion.advance(AWAY_TIMING.expand / 10).expand);
  const changes = values.slice(1).map((value, index) => value - values[index]);
  assert.ok(changes[4] > changes[0] * 5 && changes[5] > changes[9] * 5);
  assert.ok(values.every(value => value >= 0 && value <= 1));
  motion.advance(AWAY_TIMING.text); motion.setEnabled(false);
  const close = [motion.read().expand];
  for (let i = 0; i < 10; i++) close.push(motion.advance(AWAY_TIMING.expand / 10).expand);
  close.forEach((value, index) => assert.ok(Math.abs(value - (1 - values[index])) < 1e-8));
});

test('exit collapses to a line before sweeping right while the black mask fades away', () => {
  const motion = new AwayMotion(); motion.setEnabled(true, true); motion.setEnabled(false);
  const midway = motion.advance(AWAY_TIMING.expand / 2);
  assert.equal(midway.width, 1); assert.equal(midway.offset, 0); assert.ok(midway.mask > 0 && midway.mask < 1);
  const line = motion.advance(AWAY_TIMING.expand / 2);
  assert.equal(line.expand, 0); assert.equal(line.text, 0); assert.equal(line.phase, 'line-out');
  const sweep = motion.advance(AWAY_TIMING.line / 2);
  assert.ok(Math.abs(sweep.offset - .5) < 1e-8); assert.equal(sweep.expand, 0);
  assert.equal(motion.advance(AWAY_TIMING.line / 2).phase, 'hidden');
  assert.equal(motion.read().mask, 0); assert.equal(motion.running, false);
});

test('rapid toggles reverse from current geometry and repeated state broadcasts cannot restart animation', () => {
  for (const time of [50, 500, 800, 1100, 1400]) {
    const motion = new AwayMotion(); motion.setEnabled(true); motion.advance(time);
    const before = motion.read(); motion.setEnabled(false); const after = motion.read();
    for (const key of ['width', 'expand', 'offset', 'text', 'mask']) assert.equal(after[key], before[key]);
    motion.advance(150); const closing = motion.read(); motion.setEnabled(true);
    for (const key of ['width', 'expand', 'offset', 'text', 'mask']) assert.equal(motion.read()[key], closing[key]);
    motion.advance(300); const current = motion.read(); motion.setEnabled(true); assert.deepEqual(motion.read(), current);
    motion.advance(5000); assert.equal(motion.read().phase, 'visible'); assert.equal(motion.running, false);
  }
});

test('hidden pages and reduced motion settle immediately, and a delayed frame completes all stages', () => {
  const motion = new AwayMotion(); motion.setEnabled(true); motion.advance(200);
  motion.setEnabled(true, true); assert.equal(motion.read().expand, 1); assert.equal(motion.running, false);
  motion.setEnabled(false, true); assert.equal(motion.read().phase, 'hidden'); assert.equal(motion.read().mask, 0);
  motion.setEnabled(true); motion.advance(10000); assert.equal(motion.read().phase, 'visible');
  motion.setEnabled(false); motion.advance(10000); assert.equal(motion.read().phase, 'hidden'); assert.equal(motion.running, false);
});

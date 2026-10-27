import test from 'node:test';
import assert from 'node:assert/strict';
import { marqueeGlowFrame, marqueeGlowKeyframes, GLOW_RISE, GLOW_HOLD, GLOW_BLINK_START, GLOW_BLINK_END, GLOW_BLINK_OFF, GLOW_BLINK_ON, GLOW_BLINK_COUNT, GLOW_DURATION } from '../src/marquee-motion.ts';
import { MARQUEE_BANDS } from '../src/marquee-bands.ts';

test('exactly two belts scroll in opposite directions at different speeds', () => {
  const bands = Object.values(MARQUEE_BANDS);
  assert.equal(bands.length, 2);
  assert.deepEqual(bands.map(band => band.direction).sort(), ['left', 'right']);
  assert.notEqual(bands[0].speed, bands[1].speed);
});

test('the tint and halo share zero, peak and end without a leftover green layer', () => {
  for (const time of [0, GLOW_DURATION, GLOW_DURATION + 1000]) assert.deepEqual(marqueeGlowFrame(time), { text: 0, purple: 0, green: 0 });
  for (const time of [GLOW_RISE, GLOW_RISE + GLOW_HOLD / 2, GLOW_BLINK_END]) {
    assert.deepEqual(marqueeGlowFrame(time), { text: 1, purple: 0, green: 1 });
  }
});

test('after reaching peak, text and halo flash off/on exactly twice before fading', () => {
  assert.equal(GLOW_BLINK_COUNT, 2);
  assert.equal(GLOW_BLINK_END - GLOW_BLINK_START, 220, 'The two flashes now finish in 220 ms instead of 440 ms.');
  for (let blink = 0; blink < 2; blink++) {
    const off = GLOW_BLINK_START + blink * (GLOW_BLINK_OFF + GLOW_BLINK_ON);
    assert.equal(marqueeGlowFrame(off - .001).text, 1);
    assert.deepEqual(marqueeGlowFrame(off), { text: 0, purple: 0, green: 0 });
    assert.equal(marqueeGlowFrame(off + GLOW_BLINK_OFF - .001).text, 0);
    assert.deepEqual(marqueeGlowFrame(off + GLOW_BLINK_OFF), { text: 1, purple: 0, green: 1 });
  }
  let previous = 1;
  for (let time = GLOW_BLINK_END; time <= GLOW_DURATION; time += 10) {
    const strength = marqueeGlowFrame(time).text;
    assert.ok(strength <= previous && strength >= 0);
    previous = strength;
  }
});

test('animation keyframes preserve hard blink edges on the shared timeline', () => {
  for (const channel of ['text', 'purple', 'green']) {
    const frames = marqueeGlowKeyframes(channel);
    assert.equal(frames[0].offset, 0);
    assert.equal(frames.at(-1).offset, 1);
    for (let blink = 0; blink < 2; blink++) {
      const off = GLOW_BLINK_START + blink * (GLOW_BLINK_OFF + GLOW_BLINK_ON);
      for (const [time, states] of [[off, [1, 0]], [off + GLOW_BLINK_OFF, [0, 1]]]) {
        const edge = frames.filter(frame => frame.offset === time / GLOW_DURATION);
        assert.equal(edge.length, 2);
        assert.deepEqual(edge.map(frame => frame.opacity), channel === 'purple' ? [0, 0] : states);
      }
    }
  }
});

test('composited halo hue matches the text tint throughout both fades', () => {
  for (let time = 1; time < GLOW_DURATION; time += 13) {
    const { text: g, purple, green } = marqueeGlowFrame(time);
    const greenWeight = green;
    const purpleWeight = purple;
    assert.ok(Math.abs(purpleWeight + greenWeight - g) < 1e-12);
    if (g > 1e-9) assert.ok(Math.abs(greenWeight / g - g) < 1e-12);
  }
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { easeInOut, hexRgb, inverseRgb, mixRgb, sampleWordmark, WORDMARK_CYCLE, WORDMARK_HIGHLIGHT_WIDTH_RATIO, WORDMARK_MAX_BLUR, WORDMARK_MAX_GLYPH_STRETCH, WORDMARK_MIN_SPACING, WORDMARK_STEP, WORDMARK_TIMING, WORDMARKS } from '../src/wordmark-motion.ts';

test('the wordmark loops LATENITE → NOIZ BOIZ → LATENITE', () => {
  assert.deepEqual(WORDMARKS, ['LATENITE', 'NOIZ BOIZ']);
  assert.deepEqual([0, 1, 2, 3].map(step => sampleWordmark(step * WORDMARK_STEP).from), [0, 1, 0, 1]);
  assert.equal(sampleWordmark(WORDMARK_CYCLE - 1).to, 0);
});

test('one complete transition eases from rest to rest, without reversing or overshooting', () => {
  const epsilon = .001;
  assert.equal(easeInOut(0), 0);
  assert.equal(easeInOut(1), 1);
  assert.ok(easeInOut(epsilon) / epsilon < .001);
  assert.ok((1 - easeInOut(1 - epsilon)) / epsilon < .001);
  let previous = -1;
  for (let i = 0; i <= 100; i++) {
    const value = easeInOut(i / 100);
    assert.ok(value >= previous && value >= 0 && value <= 1);
    assert.ok(Math.abs(value + easeInOut(1 - i / 100) - 1) < 1e-12);
    previous = value;
  }
});

test('the single speed peak is at the cut and contraction starts at full speed', () => {
  assert.ok(easeInOut(.25) < .1);
  assert.ok(easeInOut(.75) > .9);
  const middleSpeed = (easeInOut(.51) - easeInOut(.49)) / .02;
  const earlySpeed = (easeInOut(.15) - easeInOut(.05)) / .1;
  const lateSpeed = (easeInOut(.95) - easeInOut(.85)) / .1;
  assert.ok(middleSpeed > earlySpeed * 15);
  assert.ok(middleSpeed > lateSpeed * 15);
  assert.ok(WORDMARK_TIMING.transition >= 1000);
  const start = WORDMARK_TIMING.hold;
  const cut = start + WORDMARK_TIMING.transition / 2;
  const width = time => sampleWordmark(time).glyphScaleX;
  const before = width(cut) - width(cut - 1);
  const after = width(cut) - width(cut + 1);
  const earlyTime = start + WORDMARK_TIMING.transition * .1;
  const early = width(earlyTime + 1) - width(earlyTime);
  assert.ok(before > early * 15);
  assert.ok(Math.abs(before - after) < 1e-10);
  assert.ok(width(cut + 16) < WORDMARK_MAX_GLYPH_STRETCH - .3, 'The incoming text must shrink immediately, without easing in again.');
});

test('the highlight is the strict RGB inverse of the interface purple', () => {
  const purple = hexRgb('#40009e');
  const green = inverseRgb(purple);
  assert.deepEqual(green, [191, 255, 97]);
  assert.equal(mixRgb(purple, green, 0), 'rgb(64, 0, 158)');
  assert.equal(mixRgb(purple, green, 1), 'rgb(191, 255, 97)');
  assert.deepEqual(inverseRgb(green), purple);
});

test('highlight ramps continuously through all phase boundaries and back to purple', () => {
  const switchTime = WORDMARK_TIMING.hold + WORDMARK_TIMING.transition / 2;
  for (const boundary of [WORDMARK_TIMING.hold, switchTime, WORDMARK_STEP]) {
    const left = sampleWordmark(boundary - .01);
    const right = sampleWordmark(boundary + .01);
    assert.ok(Math.abs(left.light - right.light) < 1e-6);
  }
  assert.equal(sampleWordmark(switchTime).light, 1);
  assert.equal(sampleWordmark(WORDMARK_STEP).light, 0);
  const colors = new Set();
  const base = hexRgb('#40009e');
  for (let t = WORDMARK_TIMING.hold; t < WORDMARK_STEP; t += 8) {
    const state = sampleWordmark(t);
    assert.ok(state.light >= 0 && state.light <= 1);
    colors.add(mixRgb(base, inverseRgb(base), state.light));
  }
  assert.ok(colors.size >= 6, 'The symmetric highlight must fade through multiple intermediate colors.');
});

test('highlight opacity follows glyph width from 80% to 100%, in both directions', () => {
  const half = WORDMARK_TIMING.transition / 2;
  const cut = WORDMARK_TIMING.hold + half;
  const threshold = WORDMARK_MAX_GLYPH_STRETCH * WORDMARK_HIGHLIGHT_WIDTH_RATIO;
  assert.equal(WORDMARK_HIGHLIGHT_WIDTH_RATIO, .8);
  let previousLight = 0;
  let intermediateColors = 0;
  for (let i = 0; i <= 400; i++) {
    const fraction = i / 400;
    const outgoing = sampleWordmark(WORDMARK_TIMING.hold + half * fraction);
    const incoming = sampleWordmark(cut + half * (1 - fraction));
    assert.ok(Math.abs(outgoing.glyphScaleX - incoming.glyphScaleX) < 1e-12);
    assert.ok(Math.abs(outgoing.light - incoming.light) < 1e-12);
    assert.ok(outgoing.light >= previousLight);
    if (outgoing.glyphScaleX <= threshold) assert.equal(outgoing.light, 0);
    else if (outgoing.glyphScaleX < WORDMARK_MAX_GLYPH_STRETCH) {
      assert.ok(outgoing.light > 0 && outgoing.light < 1);
      intermediateColors++;
    }
    previousLight = outgoing.light;
  }
  assert.ok(intermediateColors > 10, 'The fade must span intermediate widths, not switch at the cut.');
});

test('every cut keeps the next word fully stretched, then contracts it back to rest', () => {
  for (let step = 0; step < WORDMARKS.length; step++) {
    const offset = step * WORDMARK_STEP;
    const start = offset + WORDMARK_TIMING.hold;
    const cut = start + WORDMARK_TIMING.transition / 2;
    assert.equal(sampleWordmark(start).progress, 0);
    assert.equal(sampleWordmark(cut).progress, .5);
    assert.ok(sampleWordmark(offset + WORDMARK_STEP - .01).progress > .99999);
    assert.ok(sampleWordmark(cut - .01).glyphScaleX > WORDMARK_MAX_GLYPH_STRETCH - .001);
    assert.equal(sampleWordmark(cut - .01).phase, 'stretch');
    assert.equal(sampleWordmark(cut).phase, 'shrink');
    assert.equal(sampleWordmark(cut).from, step);
    assert.equal(sampleWordmark(cut).to, (step + 1) % WORDMARKS.length);
    assert.equal(sampleWordmark(cut).glyphScaleX, WORDMARK_MAX_GLYPH_STRETCH);
    assert.equal(sampleWordmark(cut).light, 1);
    let previousScale = WORDMARK_MAX_GLYPH_STRETCH;
    for (let t = 0; t < WORDMARK_TIMING.transition / 2; t += 4) {
      const incoming = sampleWordmark(cut + t);
      assert.equal(incoming.phase, 'shrink');
      assert.ok(incoming.glyphScaleX <= previousScale);
      assert.ok(incoming.glyphScaleX > 1);
      previousScale = incoming.glyphScaleX;
    }
    assert.equal(sampleWordmark(offset + WORDMARK_STEP).glyphScaleX, 1);
    assert.ok(sampleWordmark(offset + WORDMARK_STEP - .01).glyphScaleX < 1.001);
  }
});

test('glyph spacing tightens toward the cut and returns symmetrically to its original layout', () => {
  const start = WORDMARK_TIMING.hold;
  const half = WORDMARK_TIMING.transition / 2;
  assert.equal(sampleWordmark(start).spacingScale, 1);
  assert.equal(sampleWordmark(start + half).spacingScale, WORDMARK_MIN_SPACING);
  assert.equal(sampleWordmark(WORDMARK_STEP).spacingScale, 1);
  assert.ok(WORDMARK_MIN_SPACING > 0 && WORDMARK_MIN_SPACING < 1);
  let previous = 1;
  for (let t = 0; t <= half; t += 4) {
    const outgoing = sampleWordmark(start + t);
    const incoming = sampleWordmark(start + 2 * half - t);
    assert.ok(outgoing.spacingScale <= previous);
    assert.ok(outgoing.spacingScale >= WORDMARK_MIN_SPACING);
    assert.ok(Math.abs(outgoing.spacingScale - incoming.spacingScale) < 1e-12);
    previous = outgoing.spacingScale;
  }
});

test('horizontal blur rises to the same cut and clears symmetrically with the shared transition', () => {
  const start = WORDMARK_TIMING.hold;
  const half = WORDMARK_TIMING.transition / 2;
  assert.equal(sampleWordmark(start).blurX, 0);
  assert.equal(sampleWordmark(start + half).blurX, WORDMARK_MAX_BLUR);
  assert.equal(sampleWordmark(WORDMARK_STEP).blurX, 0);
  let previous = 0;
  for (let t = 0; t <= half; t += 4) {
    const outgoing = sampleWordmark(start + t);
    const incoming = sampleWordmark(start + 2 * half - t);
    assert.ok(outgoing.blurX >= previous && outgoing.blurX <= WORDMARK_MAX_BLUR);
    assert.ok(Math.abs(outgoing.blurX - incoming.blurX) < 1e-10);
    previous = outgoing.blurX;
  }
});

test('the highlight keeps intermediate shades even with a sharp geometry speed peak', () => {
  for (let t = WORDMARK_TIMING.hold; t < WORDMARK_STEP - 16; t += 16) {
    assert.ok(Math.abs(sampleWordmark(t + 16).light - sampleWordmark(t).light) < .3);
  }
});

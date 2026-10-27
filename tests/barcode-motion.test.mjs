import test from 'node:test';
import assert from 'node:assert/strict';
import { BARCODE_CONTENT, BARCODE_CODEWORDS, BARCODE_BARS, BARCODE_WIDTH, BARCODE_QUIET_ZONE } from '../src/barcode-data.ts';
import { BarcodeMotion, BARCODE_STEP, BARCODE_HOLD, BARCODE_FLASH } from '../src/barcode-motion.ts';

test('the generated Code 128 B barcode encodes LATENITE with a valid checksum and quiet zones', () => {
  assert.equal(BARCODE_CODEWORDS[0], 104);
  assert.equal(BARCODE_CODEWORDS.at(-1), 106);
  assert.equal(String.fromCharCode(...BARCODE_CODEWORDS.slice(1, -2).map(code => code + 32)), BARCODE_CONTENT);
  const checksum = BARCODE_CODEWORDS.slice(0, -2).reduce((sum, code, index) => sum + code * (index || 1), 0) % 103;
  assert.equal(BARCODE_CODEWORDS.at(-2), checksum);
  assert.equal(BARCODE_BARS.length, 34);
  assert.equal(BARCODE_WIDTH, 143);
  assert.equal(BARCODE_BARS[0].x, BARCODE_QUIET_ZONE);
  assert.equal(BARCODE_WIDTH - BARCODE_BARS.at(-1).x - BARCODE_BARS.at(-1).width, BARCODE_QUIET_ZONE);
  assert.ok(BARCODE_BARS.every((bar, index) => bar.width >= 1 && bar.width <= 4 && (!index || bar.x > BARCODE_BARS[index - 1].x + BARCODE_BARS[index - 1].width)));
});

test('bars disappear and reappear one by one in the same left-to-right order', () => {
  const length = BARCODE_BARS.length, motion = new BarcodeMotion(length, () => 0);
  assert.ok(motion.sample(5999).visible.every(Boolean));
  for (let step = 0; step < length; step++) {
    const frame = motion.sample(6000 + step * BARCODE_STEP);
    assert.equal(frame.phase, 'erase');
    assert.deepEqual(frame.visible, Array.from({ length }, (_, index) => index > step));
  }
  const reveal = 6000 + length * BARCODE_STEP + BARCODE_HOLD;
  assert.ok(motion.sample(reveal - 1).visible.every(value => !value));
  for (let step = 0; step < length; step++) {
    const frame = motion.sample(reveal + step * BARCODE_STEP);
    assert.equal(frame.phase, 'reveal');
    assert.deepEqual(frame.visible, Array.from({ length }, (_, index) => index <= step));
  }
  assert.equal(motion.sample(reveal + length * BARCODE_STEP).phase, 'idle');
});

test('the rare fluorescent double flash is independent and returns to black', () => {
  const motion = new BarcodeMotion(BARCODE_BARS.length, () => 0);
  motion.sample(6000); motion.sample(8830);
  for (const [offset, highlighted] of [[0, true], [BARCODE_FLASH - 1, true], [BARCODE_FLASH, false], [2 * BARCODE_FLASH, true], [3 * BARCODE_FLASH, false]]) {
    const frame = motion.sample(9000 + offset);
    assert.equal(frame.highlighted, highlighted);
    assert.equal(frame.phase, 'idle');
    assert.ok(frame.visible.every(Boolean));
  }
  assert.equal(motion.sample(15000).phase, 'idle');
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { hexRgb, inverseRgb } from '../src/wordmark-motion.ts';

test('the overlay palette uses the strict inverse of TOYO82', async () => {
  const palette = await readFile(new URL('../src/palette.css', import.meta.url), 'utf8');
  const purple = palette.match(/--accent:\s*(#[\da-f]+)/i)[1];
  const green = palette.match(/--accent-inverse:\s*(#[\da-f]+)/i)[1];
  assert.equal(purple, '#40009e');
  assert.deepEqual(hexRgb(green), inverseRgb(hexRgb(purple)));
  for (const file of ['style.css', 'stage.css', 'config.css']) {
    const css = await readFile(new URL(`../src/${file}`, import.meta.url), 'utf8');
    assert.doesNotMatch(css, /#(?:beff60|41009f|9464ed|7040bf|8d64bd)\b/i);
  }
});

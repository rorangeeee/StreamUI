import test from 'node:test';
import assert from 'node:assert/strict';
import { titleAtStep } from '../src/title-sequence.ts';

test('English and Chinese share one title position and alternate in order', () => {
  assert.deepEqual([0, 1, 2, 3, 4, 5].map(step => titleAtStep(step, 2, 2)), [
    { language: 'en', index: 0, layerIndex: 0 }, { language: 'zh', index: 0, layerIndex: 2 },
    { language: 'en', index: 1, layerIndex: 1 }, { language: 'zh', index: 1, layerIndex: 3 },
    { language: 'en', index: 0, layerIndex: 0 }, { language: 'zh', index: 0, layerIndex: 2 },
  ]);
});
test('unequal title lists each continue their own cycle across language switches', () => {
  const sequence = Array.from({ length: 18 }, (_, step) => titleAtStep(step, 3, 2));
  assert.deepEqual(sequence.filter(item => item.language === 'en').map(item => item.index), [0, 1, 2, 0, 1, 2, 0, 1, 2]);
  assert.deepEqual(sequence.filter(item => item.language === 'zh').map(item => item.index), [0, 1, 0, 1, 0, 1, 0, 1, 0]);
});

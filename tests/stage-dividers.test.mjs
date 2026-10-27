import test from 'node:test';
import assert from 'node:assert/strict';
import { stageDividerPaths } from '../src/stage-dividers.ts';
import { defaultStageLayout, STAGE_WIDTH, STAGE_HEIGHT } from '../src/stage-layout.ts';

test('the default stage draws only the four requested shared partitions', () => {
  const layout = defaultStageLayout();
  const rect = id => {
    const window = layout.windows[id];
    return { ...window, x: window.x * STAGE_WIDTH, y: window.y * STAGE_HEIGHT, width: window.width * STAGE_WIDTH, height: window.height * STAGE_HEIGHT };
  };
  assert.deepEqual(stageDividerPaths(rect('stream-window'), rect('spectrogram-window'), rect('waveform-window')), {
    'main-top': 'M0 276.2784 L3840 276.2784',
    'main-bottom': 'M0 1883.99 L3840 1883.99',
    'audio-split': 'M2972.7 1883.99 L2972.7 2102.605',
    'audio-bottom': 'M0 2102.605 L2972.7 2102.605 M2972.7 2102.605 L3840 2102.605',
  });
});

test('partitions follow moved, resized and rotated panels without closing a box', () => {
  const stream = { x: 100, y: 200, width: 400, height: 300, angle: 90 };
  const spectrum = { x: 10, y: 800, width: 300, height: 100, angle: 0 };
  const waveform = { x: 310, y: 800, width: 100, height: 150, angle: 0 };
  const paths = stageDividerPaths(stream, spectrum, waveform);
  assert.equal(paths['main-top'], 'M450 150 L450 550');
  assert.equal(paths['main-bottom'], 'M150 150 L150 550');
  assert.equal(paths['audio-split'], 'M310 800 L310 950');
  assert.equal(paths['audio-bottom'], 'M10 900 L310 900 M310 950 L410 950');
  assert.ok(Object.values(paths).every(path => !/z/i.test(path)));
  assert.deepEqual(stageDividerPaths(stream, spectrum, { ...waveform, inverted: true }), paths);
});

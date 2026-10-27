import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultStageLayout, PANEL_IDS, STAGE_LAYOUT_VERSION } from '../src/stage-layout.ts';
import { parseLayout } from '../src/layout.ts';

test('v3 layout fills the ultrawide aperture and defaults only the oscilloscope to inverted', () => {
  const layout = defaultStageLayout();
  assert.equal(STAGE_LAYOUT_VERSION, 3);
  assert.deepEqual(parseLayout(layout, PANEL_IDS), layout);
  assert.equal(layout.windows['stream-window'].width, 1);
  assert.equal(layout.windows['stream-window'].x, 0);
  assert.equal(layout.windows['waveform-window'].inverted, true);
  assert.equal(layout.windows['spectrogram-window'].inverted, false);
  assert.ok(Math.abs(layout.windows['wordmark-window'].x - layout.windows['wordmark-blur-window'].width) < 1e-10);
  assert.ok(Math.abs(layout.windows['spectrogram-window'].width - layout.windows['waveform-window'].x) < 1e-10);
  for (const window of Object.values(layout.windows)) {
    assert.ok(window.x >= 0 && window.y >= 0 && window.x + window.width <= 1.000001 && window.y + window.height <= 1.000001);
  }
});

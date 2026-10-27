import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultStageLayout, isStageMode, PANEL_IDS } from '../src/stage-layout.ts';
import { parseLayout } from '../src/layout.ts';
import { resizeRect } from '../src/window-geometry.ts';

test('16:9 reserves the entire canvas for video and places the UI around it', () => {
  const layout = defaultStageLayout('16:9');
  assert.deepEqual(parseLayout(layout, PANEL_IDS), layout);
  assert.deepEqual(layout.windows['stream-window'], { x: 0, y: 0, width: 1, height: 1, angle: 0, inverted: false });
  const rail = layout.windows['wordmark-window'];
  const title = layout.windows['wordmark-blur-window'];
  const chat = layout.windows['chat-window'];
  assert.ok(rail.width < .06 && rail.height > .7 && rail.x === 0);
  assert.ok(title.y === 0 && title.width < .2);
  assert.ok(Math.abs(title.x + title.width / 2 - .5) < 1e-10);
  assert.ok(chat.x > .85 && chat.height > .85 && chat.x + chat.width < 1);
});

test('preset objects and mode validation isolate edits between the two layouts', () => {
  const first = defaultStageLayout('21:9');
  first.windows['chat-window'].x = 0;
  first.order.reverse();
  assert.notEqual(defaultStageLayout('21:9').windows['chat-window'].x, 0);
  assert.notDeepEqual(defaultStageLayout('16:9').order, first.order);
  for (const value of ['21:9', '16:9']) assert.equal(isStageMode(value), true);
  for (const value of [null, undefined, '16-9', '__proto__', '', 16]) assert.equal(isStageMode(value), false);
});

test('the narrow vertical rail can resize smoothly without jumping to the old audio-panel minimum', () => {
  const rail = { x: 0, y: 299.669, width: 190.318, height: 1560.663, angle: 0 };
  const resized = resizeRect(rail, { right: true }, 12, 0, 80, 120);
  assert.equal(resized.width, rail.width + 12);
  assert.equal(resized.x, 0);
  const half = { ...rail, width: rail.width / 2, height: rail.height / 2 };
  assert.equal(resizeRect(half, { right: true }, 6, 0, 40, 60).width, half.width + 6);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { transitionTiles, sampleTransition, transitionManifest, transitionComponentVisible, TRANSITION_PURPLE, TRANSITION_HIGHLIGHT } from '../src/transition-model.ts';
import { transitionSettings, transitionLayout } from '../src/transition-settings.ts';
const at = frame => sampleTransition(frame * 1000 / 60, 104);

test('random square tiles cover the canvas exactly, including clipped right and bottom edges', () => {
  for (const [width, height] of [[3840, 2160], [1920, 1080], [2560, 1440]]) {
    const tiles = transitionTiles(width, height);
    assert.equal(tiles.length, Math.ceil(width / 300) * Math.ceil(height / 300));
    assert.equal(tiles.reduce((sum, tile) => sum + tile.width * tile.height, 0), width * height);
    assert.equal(new Set(tiles.map(tile => `${tile.x},${tile.y}`)).size, tiles.length);
    assert.ok(tiles.every(t => t.width > 0 && t.width <= 300 && t.height > 0 && t.height <= 300 && t.x + t.width <= width && t.y + t.height <= height));
  }
});
test('random order is seekable and repeatable; the one-second fill adapts to the number of tiles', () => {
  assert.deepEqual(transitionTiles(3840, 2160, 300, 42), transitionTiles(3840, 2160, 300, 42));
  assert.notDeepEqual(transitionTiles(3840, 2160, 300, 42), transitionTiles(3840, 2160, 300, 43));
  for (const count of [12, 28, 104, 400]) {
    assert.equal(sampleTransition(0, count).visibleTiles, 0);
    assert.equal(sampleTransition(500, count).visibleTiles, Math.floor(count / 2));
    assert.equal(sampleTransition(1000, count).visibleTiles, count);
  }
});
test('the OBS cut point is fully opaque and remains covered through construction and both capture flashes', () => {
  assert.equal(at(59).fullyOpaque, false);
  for (let frame = 60; frame < 338; frame++) assert.equal(at(frame).fullyOpaque, true, `frame ${frame}`);
  assert.equal(at(338).fullyOpaque, false);
  for (const fps of [24, 30, 60]) {
    const info = transitionManifest(fps);
    assert.equal(info.transitionPointMs, 1000);
    assert.equal(info.transitionPointFrame, fps);
    assert.equal(info.totalFrames, fps * 6);
  }
});
test('RESCALING flashes twice, stays visible, then reaches black before the full-screen flash', () => {
  assert.deepEqual([60, 65, 70, 75, 80].map(f => at(f).textVisible), [true, false, true, false, true]);
  assert.equal(at(80).textColor, 'rgb(191, 255, 97)');
  assert.notEqual(at(100).textColor, at(80).textColor);
  assert.equal(at(114).textColor, 'rgb(0, 0, 0)');
  assert.equal(at(119).cover, TRANSITION_PURPLE);
  assert.equal(at(120).textVisible, false);
});
test('the global highlight is a single hard flash followed by a black tunnel', () => {
  assert.equal(TRANSITION_HIGHLIGHT, '#' + (0xffffff ^ parseInt(TRANSITION_PURPLE.slice(1), 16)).toString(16).padStart(6, '0'));
  for (let frame = 120; frame < 126; frame++) assert.equal(at(frame).cover, TRANSITION_HIGHLIGHT);
  assert.equal(at(126).cover, '#000000');
  assert.equal(at(126).tunnelVisible, true);
});
test('the tunnel accelerates forward without reversing and clears even its smallest frame', () => {
  const scales = [126, 146, 166, 186, 206, 226].map(frame => at(frame).tunnelScale);
  for (let i = 1; i < scales.length; i++) assert.ok(scales[i] > scales[i - 1]);
  const velocities = scales.slice(1).map((scale, i) => scale - scales[i]);
  for (let i = 1; i < velocities.length; i++) assert.ok(velocities[i] > velocities[i - 1]);
  assert.ok(.96 * .76 ** 7 * at(227).tunnelScale > 1);
  assert.equal(at(228).tunnelVisible, false);
});
test('outlines draw in order before the staggered component flashes begin', () => {
  assert.ok(at(235).lineProgress[0] > 0);
  assert.equal(at(235).lineProgress[1], 0);
  assert.deepEqual(at(270).lineProgress, [1, 1, 1, 1]);
  assert.ok(at(269).components.every(value => !value));
  assert.equal(at(270).components[0], true);
  assert.equal(at(270).components[1], false);
  assert.deepEqual([270, 273, 276, 279, 282].map(frame => transitionComponentVisible(frame, 0)), [true, false, true, false, true]);
  assert.ok(at(317).components.every(Boolean));
});
test('the capture area flashes twice below the HUD, then clears before a fully transparent handoff', () => {
  assert.deepEqual([318, 323, 328, 333].map(frame => at(frame).captureColor), [TRANSITION_HIGHLIGHT, '#000000', TRANSITION_HIGHLIGHT, '#000000']);
  assert.equal(at(337).captureRevealed, false);
  assert.equal(at(338).captureRevealed, true);
  assert.equal(at(338).arrivalVisible, true);
  assert.equal(at(350).arrivalVisible, false);
  assert.equal(at(359).phase, 'complete');
  assert.equal(at(359).cover, null);
});
test('visual snapshots retain both layouts and titles while dropping connection credentials', () => {
  const input = { config: { titles: { english: ['LIVE'], chinese: ['直播'] }, laplace: { token: 'private-token' }, obs: { password: 'private-password' } } };
  const snapshot = transitionSettings(input);
  assert.deepEqual(snapshot.titles, input.config.titles);
  assert.ok(!JSON.stringify(snapshot).includes('private-'));
  assert.notDeepEqual(transitionLayout(snapshot, '21:9'), transitionLayout(snapshot, '16:9'));
  assert.throws(() => transitionSettings({ canvas: { width: 0, height: 2160 } }));
  assert.throws(() => transitionSettings({ layoutProfiles: { '16:9': { windows: {}, order: [] } } }));
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { transitionTiles, sampleTransition, transitionManifest, transitionComponentVisible, transitionTunnelRectVisible, TRANSITION_CUES, TRANSITION_PURPLE, TRANSITION_HIGHLIGHT } from '../src/transition-model.ts';
import { transitionSettings, transitionLayout } from '../src/transition-settings.ts';
import { defaultStageLayout } from '../src/stage-layout.ts';
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
test('the OBS cut point remains fully opaque until the capture pixels begin dissolving', () => {
  assert.equal(at(59).fullyOpaque, false);
  for (let frame = 60; frame <= TRANSITION_CUES.captureDissolve; frame++) assert.equal(at(frame).fullyOpaque, true, `frame ${frame}`);
  assert.equal(at(TRANSITION_CUES.captureDissolve + 1).fullyOpaque, false);
  for (const fps of [24, 30, 60]) {
    const info = transitionManifest(fps);
    assert.equal(info.transitionPointMs, 1000);
    assert.equal(info.transitionPointFrame, fps);
    assert.equal(info.durationMs, 7500);
    assert.equal(info.totalFrames, Math.ceil(fps * 7.5));
    assert.equal(info.opaqueUntilMs, TRANSITION_CUES.captureDissolve / .06);
  }
});
test('RESCALING keeps its original opening flashes and reaches black before the tunnel builds', () => {
  assert.deepEqual([60, 65, 70, 75, 80].map(f => at(f).textVisible), [true, false, true, false, true]);
  assert.equal(at(80).textColor, 'rgb(191, 255, 97)');
  assert.notEqual(at(100).textColor, at(80).textColor);
  assert.equal(at(114).textColor, 'rgb(0, 0, 0)');
  assert.equal(at(119).cover, TRANSITION_PURPLE);
  assert.equal(at(120).textVisible, true);
  assert.equal(at(120).textColor, 'rgb(0, 0, 0)');
});
test('black RESCALING fades out on the same curve as the purple background darkens', () => {
  assert.equal(TRANSITION_HIGHLIGHT, '#' + (0xffffff ^ parseInt(TRANSITION_PURPLE.slice(1), 16)).toString(16).padStart(6, '0'));
  const channels = value => value.match(/\d+/g).map(Number);
  let previousBackground = [64, 0, 158], previousOpacity = 1;
  for (let frame = 120; frame < 156; frame++) {
    const state = at(frame), background = channels(state.cover);
    assert.equal(state.phase, 'tunnel-build');
    assert.ok(state.textVisible && state.tunnelVisible);
    assert.ok(background.every((channel, index) => channel <= previousBackground[index]));
    assert.equal(state.textColor, 'rgb(0, 0, 0)');
    assert.ok(state.textOpacity <= previousOpacity);
    assert.deepEqual(background, [64, 0, 158].map(channel => Math.round(channel * state.textOpacity)));
    previousBackground = background; previousOpacity = state.textOpacity;
  }
  assert.equal(at(156).cover, '#000000');
  assert.equal(at(156).textColor, 'rgb(0, 0, 0)');
  assert.equal(at(156).textOpacity, 0);
  assert.equal(at(156).textVisible, false);
  for (let frame = 0; frame <= TRANSITION_CUES.end; frame++) assert.notEqual(at(frame).cover, TRANSITION_HIGHLIGHT);
});

test('tunnel rectangles flash from largest to smallest with overlapping entrances, then stay visible', () => {
  assert.deepEqual(at(119).tunnelRects, Array(8).fill(false));
  assert.deepEqual(at(120).tunnelRects, [true, false, false, false, false, false, false, false]);
  for (let index = 0; index < 8; index++) {
    const start = 120 + index * 3;
    assert.deepEqual([-1, 0, 3, 6, 9, 12].map(offset => transitionTunnelRectVisible(start + offset, index)), [false, true, false, true, false, true]);
  }
  assert.ok(at(126).tunnelRects.filter(Boolean).length > 1);
  assert.ok(at(156).tunnelRects.every(Boolean));
  assert.equal(at(155).tunnelScale, 1);
});
test('the tunnel accelerates for 2.2 seconds from a slow approach into a much steeper final rush', () => {
  assert.equal((TRANSITION_CUES.tunnelEnd - TRANSITION_CUES.tunnelReady) / 60, 2.2);
  const scales = [156, 178, 200, 222, 244, 266].map(frame => at(frame).tunnelScale);
  for (let i = 1; i < scales.length; i++) assert.ok(scales[i] > scales[i - 1]);
  const velocities = scales.slice(1).map((scale, i) => scale - scales[i]);
  for (let i = 1; i < velocities.length; i++) assert.ok(velocities[i] > velocities[i - 1]);
  assert.ok(at(222).tunnelScale < 1.2, 'the first half is visibly slower than the old cubic zoom');
  const speed = frame => at(frame + 1).tunnelScale - at(frame).tunnelScale;
  assert.ok(speed(284) > speed(222) * 30, 'the final rush is dramatically faster than the midpoint');
  assert.ok(speed(286) * 60 > 60, 'the exit is faster than the old short zoom despite its longer duration');
  assert.ok(.96 * .76 ** 7 * at(287).tunnelScale > 1);
  assert.equal(at(288).tunnelVisible, false);
  assert.ok(Number.isFinite(at(1000).tunnelScale));
  assert.ok(Math.abs(at(288).tunnelScale - 12) < 1e-10);
});
test('outlines draw in order before the staggered component flashes begin', () => {
  assert.ok(at(295).lineProgress[0] > 0);
  assert.equal(at(295).lineProgress[1], 0);
  assert.deepEqual(at(330).lineProgress, [1, 1, 1, 1]);
  assert.ok(at(329).components.every(value => !value));
  assert.equal(at(330).components[0], true);
  assert.equal(at(330).components[1], false);
  assert.deepEqual([330, 333, 336, 339, 342].map(frame => transitionComponentVisible(frame, 0)), [true, false, true, false, true]);
  assert.ok(at(379).components.every(Boolean));
});
test('capture pixels disappear monotonically over one second below the HUD and can be sampled backwards', () => {
  for (const count of [12, 28, 78, 104]) {
    let previous = 0;
    for (let frame = 380; frame <= 440; frame++) {
      const state = sampleTransition(frame / .06, 104, 8, count);
      assert.ok(state.captureDissolvedTiles >= previous && state.captureDissolvedTiles <= count);
      assert.ok(state.components.every(Boolean));
      previous = state.captureDissolvedTiles;
    }
    assert.equal(sampleTransition(410 / .06, 104, 8, count).captureDissolvedTiles, Math.floor(count / 2));
    assert.equal(sampleTransition(440 / .06, 104, 8, count).captureDissolvedTiles, count);
  }
  assert.equal(at(439).captureRevealed, false);
  assert.equal(at(440).captureRevealed, true);
  assert.equal(at(440).arrivalVisible, true);
  assert.equal(at(446).arrivalVisible, false);
  assert.equal(at(380).captureDissolvedTiles, 0);
  assert.equal(at(449).phase, 'complete');
  assert.equal(at(449).cover, null);
});

test('saved 16:9 titles are centered without mutating the profile or changing vertical position and size', () => {
  const saved = defaultStageLayout('16:9');
  Object.assign(saved.windows['wordmark-blur-window'], { x: 0, y: .02, width: .3 });
  const settings = transitionSettings({ layoutProfiles: { '16:9': saved } });
  const title = transitionLayout(settings, '16:9').windows['wordmark-blur-window'];
  assert.deepEqual(title, { ...saved.windows['wordmark-blur-window'], x: .35 });
  assert.equal(settings.layoutProfiles['16:9'].windows['wordmark-blur-window'].x, 0);
  assert.deepEqual(transitionLayout(settings, '21:9'), defaultStageLayout('21:9'));
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

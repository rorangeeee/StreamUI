import test from 'node:test';
import assert from 'node:assert/strict';
import { TransitionPlayback } from '../src/transition-playback.ts';
import { TRANSITION_DURATION } from '../src/transition-model.ts';

function fixture() {
  const applied = [], prepared = [], drawn = [];
  let resets = 0;
  const playback = new TransitionPlayback({
    apply: state => applied.push(state),
    prepare: (state, mode) => prepared.push({ state, mode }),
    draw: time => drawn.push(time),
    reset: () => resets++,
  });
  return { playback, applied, prepared, drawn, get resets() { return resets; } };
}

test('initial connection and same-layout Host updates apply without playing a transition', () => {
  const f = fixture();
  f.playback.update('16:9', 'initial');
  f.playback.update('16:9', 'track update');
  assert.deepEqual(f.applied, ['initial', 'track update']);
  assert.deepEqual(f.drawn, []);
  assert.equal(f.playback.running, false);
});

test('both directions keep the old layout until the one-second opaque cut', () => {
  for (const [from, to] of [['21:9', '16:9'], ['16:9', '21:9']]) {
    const f = fixture();
    f.playback.update(from, 'old');
    f.playback.update(to, 'new');
    f.playback.advance(999);
    assert.deepEqual(f.applied, ['old']);
    f.playback.advance(1);
    assert.deepEqual(f.applied, ['old', 'new']);
    assert.equal(f.playback.running, true);
    f.playback.advance(TRANSITION_DURATION - 1000);
    assert.equal(f.playback.running, false);
    assert.equal(f.drawn.at(-1), TRANSITION_DURATION);
  }
});

test('Host broadcasts during a transition keep its clock and use the newest target settings', () => {
  const f = fixture();
  f.playback.update('21:9', 'old');
  f.playback.update('16:9', 'first');
  f.playback.advance(500);
  f.playback.update('16:9', 'latest title');
  assert.deepEqual(f.drawn, [0, 500]);
  f.playback.advance(500);
  assert.equal(f.applied.at(-1), 'latest title');
  f.playback.advance(3500);
  f.playback.update('16:9', 'latest geometry');
  assert.equal(f.applied.at(-1), 'latest geometry');
  assert.equal(f.drawn.at(-1), 4500);
  f.playback.advance(TRANSITION_DURATION - 4500);
  assert.equal(f.playback.running, false);
});

test('reversing during pixel fill cancels cleanly before any layout change', () => {
  const f = fixture();
  f.playback.update('21:9', 'old');
  f.playback.update('16:9', 'target');
  f.playback.advance(700);
  f.playback.update('21:9', 'back');
  assert.equal(f.playback.running, false);
  assert.deepEqual(f.applied, ['old', 'back']);
  assert.equal(f.resets, 2);
});

test('a reversal after the cut queues the latest state and switches again under its own cover', () => {
  const f = fixture();
  f.playback.update('21:9', 'initial');
  f.playback.update('16:9', 'wide');
  f.playback.advance(2000);
  f.playback.update('21:9', 'reverse');
  f.playback.update('21:9', 'latest reverse');
  assert.deepEqual(f.applied, ['initial', 'wide']);
  f.playback.advance(TRANSITION_DURATION - 2000);
  assert.equal(f.playback.running, true);
  assert.equal(f.drawn.at(-1), 0);
  f.playback.advance(1000);
  assert.equal(f.applied.at(-1), 'latest reverse');
  f.playback.advance(TRANSITION_DURATION - 1000);
  assert.equal(f.playback.running, false);
});

test('a superseded queued reversal does not replay after the current transition', () => {
  const f = fixture();
  f.playback.update('21:9', 'initial');
  f.playback.update('16:9', 'wide');
  f.playback.advance(2000);
  f.playback.update('21:9', 'cancelled reverse');
  f.playback.update('16:9', 'latest wide');
  f.playback.advance(TRANSITION_DURATION - 2000);
  assert.equal(f.playback.running, false);
  assert.equal(f.applied.at(-1), 'latest wide');
  assert.ok(!f.applied.includes('cancelled reverse'));
});

test('hidden pages, reduced motion and canvas resizing clear layers and settle to the latest state', () => {
  const f = fixture();
  f.playback.update('21:9', 'initial');
  f.playback.update('16:9', 'wide');
  f.playback.advance(2000);
  f.playback.update('21:9', 'queued');
  f.playback.finish();
  assert.equal(f.playback.running, false);
  assert.equal(f.applied.at(-1), 'queued');
  f.playback.update('16:9', 'resized', false);
  assert.equal(f.playback.running, false);
  assert.equal(f.applied.at(-1), 'resized');
});

test('a delayed animation frame still commits once and removes the completed overlay', () => {
  const f = fixture();
  f.playback.update('21:9', 'initial');
  f.playback.update('16:9', 'wide');
  f.playback.advance(12000);
  assert.equal(f.playback.running, false);
  assert.equal(f.drawn.at(-1), TRANSITION_DURATION);
  assert.deepEqual(f.applied, ['initial', 'wide']);
  assert.equal(f.prepared.length, 2);
});

test('the longer tunnel keeps the overlay active beyond the old six-second endpoint', () => {
  const f = fixture();
  f.playback.update('21:9', 'initial');
  f.playback.update('16:9', 'wide');
  f.playback.advance(6000);
  assert.equal(f.playback.running, true);
  assert.equal(f.drawn.at(-1), 6000);
  f.playback.advance(TRANSITION_DURATION - 6000);
  assert.equal(f.playback.running, false);
  assert.equal(f.drawn.at(-1), 7500);
});

test('an OBS start plays immediately without knowing the delayed destination scene', () => {
  const f = fixture();
  f.playback.update('21:9', 'old');
  f.playback.begin('21:9', 'old');
  assert.equal(f.playback.running, true);
  assert.equal(f.drawn.at(-1), 0);
  f.playback.advance(600);
  f.playback.update('16:9', 'early target');
  assert.deepEqual(f.applied, ['old']);
  assert.equal(f.drawn.at(-1), 600);
  f.playback.advance(400);
  assert.equal(f.applied.at(-1), 'early target');
});

test('the delayed OBS scene retargets the covered animation without replaying it', () => {
  const f = fixture();
  f.playback.update('21:9', 'old');
  f.playback.begin('21:9', 'old');
  f.playback.advance(1100);
  f.playback.update('16:9', 'delayed scene');
  assert.equal(f.applied.at(-1), 'delayed scene');
  assert.equal(f.drawn.at(-1), 1100);
  f.playback.update('16:9', 'duplicate scene status');
  assert.equal(f.drawn.at(-1), 1100);
  f.playback.advance(TRANSITION_DURATION - 1100);
  assert.equal(f.playback.running, false);
  assert.equal(f.drawn.filter(time => time === 0).length, 1);
});

test('a newly visible browser joins the current OBS clock and an expired event cannot replay', () => {
  const f = fixture();
  f.playback.begin('16:9', 'joined scene', 3200);
  assert.equal(f.playback.running, true);
  assert.equal(f.drawn.at(-1), 3200);
  assert.equal(f.applied.at(-1), 'joined scene');
  f.playback.begin('16:9', 'expired', TRANSITION_DURATION + 100);
  assert.equal(f.playback.running, false);
  assert.equal(f.applied.at(-1), 'expired');
  f.playback.begin('21:9', 'hidden scene', 400, false);
  assert.equal(f.playback.running, false);
  assert.equal(f.applied.at(-1), 'hidden scene');
});

test('a new OBS transition interrupts an older one and retains the latest scene', () => {
  const f = fixture();
  f.playback.update('21:9', 'initial');
  f.playback.begin('21:9', 'first');
  f.playback.advance(2000);
  f.playback.update('16:9', 'first destination');
  f.playback.begin('16:9', 'second');
  assert.equal(f.drawn.at(-1), 0);
  f.playback.advance(1100);
  f.playback.update('21:9', 'second destination');
  f.playback.advance(TRANSITION_DURATION - 1100);
  assert.equal(f.playback.running, false);
  assert.equal(f.applied.at(-1), 'second destination');
});

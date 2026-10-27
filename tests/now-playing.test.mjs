import test from 'node:test';
import assert from 'node:assert/strict';
import { nowPlayingText, nowPlayingRuns, nowPlayingLit } from '../src/now-playing-data.ts';
import { sampleOnAir } from '../src/on-air-motion.ts';

test('automatic tracks use the exact NOW PLAYING format and preserve both scripts', () => {
  assert.equal(nowPlayingText({ title: '夜行 LATENITE', artist: 'When 歌手', playing: true }), 'NOW PLAYING:  夜行 LATENITE-When 歌手');
  assert.equal(nowPlayingText({ title: 'Song', artist: '', playing: true }), 'NOW PLAYING:  Song');
  assert.equal(nowPlayingText({ title: 'Song', artist: 'Artist', playing: false }), '');
  assert.equal(nowPlayingText({ title: '   ', artist: 'Artist', playing: true }), '');
  assert.equal(nowPlayingText(undefined), '');
});

test('font runs keep exact spacing while selecting the Chinese face for full-width glyphs', () => {
  const text = 'NOW PLAYING:  夜行（Live）-歌手';
  const runs = nowPlayingRuns(text);
  assert.equal(runs.map(run => run.text).join(''), text);
  assert.equal(runs[0].language, 'en');
  assert.ok(runs.some(run => run.language === 'zh' && run.text.includes('夜行（')));
  assert.ok(runs.some(run => run.language === 'en' && run.text.includes('Live')));
});

test('track blinking matches the O in ON AIR at every edge with no fade', () => {
  for (const time of [0, 799.9, 800, 1599.9, 1600, 2399.9, 2400, 3200])
    assert.equal(nowPlayingLit(time), sampleOnAir(time).recording);
});

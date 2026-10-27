import test from 'node:test';
import assert from 'node:assert/strict';
import { ChatPlayback, CHAT_COVER_DURATION, CHAT_UNCOVER_DURATION, CHAT_MESSAGE_HOLD, CHAT_GIFT_HOLD, chatDisplayLines } from '../src/chat-playback.ts';

const entry = (kind, body, key = body) => ({ kind, body, key, username: '用户甲', level: 'UL 23', timestamp: 0 });

test('ordinary chat shows just its body and holds one complete message before replacing it', () => {
  const playback = new ChatPlayback();
  playback.enqueue(entry('message', '第一条'));
  playback.enqueue(entry('message', '第二条'));
  playback.advance(30);
  assert.deepEqual(playback.read().lines, ['第一条']);
  playback.advance(CHAT_MESSAGE_HOLD - 1);
  assert.equal(playback.read().entry.body, '第一条');
  playback.advance(1);
  assert.equal(playback.read().entry.body, '第二条');
  playback.advance(100000);
  assert.deepEqual(playback.read().lines, ['第二条']);
  assert.equal(playback.settled, true);
  playback.enqueue(entry('message', '新消息唤醒播放'));
  assert.equal(playback.settled, false);
});

test('gift coverage completes before either text line appears', () => {
  const playback = new ChatPlayback();
  playback.enqueue(entry('gift', '送出 [小花花]'));
  assert.equal(playback.read().fill, 0);
  assert.deepEqual(playback.read().lines, ['', '']);
  playback.advance(CHAT_COVER_DURATION / 2);
  assert.ok(Math.abs(playback.read().fill - .5) < 1e-12);
  assert.deepEqual(playback.read().lines, ['', '']);
  playback.advance(CHAT_COVER_DURATION / 2);
  assert.equal(playback.read().phase, 'typing');
  assert.equal(playback.read().fill, 1);
  playback.advance(1000);
  assert.equal(playback.read().phase, 'hold');
  assert.deepEqual(playback.read().lines, ['用户甲', '送出[小花花]']);
});

test('gifts preempt chat, queue independently, and resume the interrupted message afterwards', () => {
  const playback = new ChatPlayback();
  playback.reducedMotion = true;
  playback.enqueue(entry('message', '继续阅读这一条'));
  playback.enqueue(entry('gift', '送出 [A]'));
  playback.enqueue(entry('gift', '送出 [B]'));
  playback.enqueue(entry('message', '下一条'));
  playback.advance(0);
  assert.deepEqual(playback.read().lines, ['用户甲', '送出[A]']);
  playback.advance(CHAT_GIFT_HOLD);
  assert.deepEqual(playback.read().lines, ['用户甲', '送出[B]']);
  playback.advance(CHAT_GIFT_HOLD);
  assert.deepEqual(playback.read().lines, ['继续阅读这一条']);
  playback.advance(CHAT_MESSAGE_HOLD);
  assert.deepEqual(playback.read().lines, ['下一条']);
});

test('gift exit removes text before the purple retreats and returns to an empty slot', () => {
  const playback = new ChatPlayback();
  playback.enqueue(entry('gift', '送出 [A]'));
  playback.advance(CHAT_COVER_DURATION + 30 + 160 + 50 + CHAT_GIFT_HOLD);
  assert.equal(playback.read().phase, 'uncover');
  assert.deepEqual(playback.read().lines, ['', '']);
  playback.advance(CHAT_UNCOVER_DURATION);
  assert.equal(playback.read().entry, null);
  assert.equal(playback.read().fill, 0);
});

test('emoji and joined glyphs are never split and SC retains amount and message', () => {
  const playback = new ChatPlayback();
  playback.enqueue(entry('message', '👨‍👩‍👧‍👦好'));
  playback.advance(10);
  assert.deepEqual(playback.read().lines, ['👨‍👩‍👧‍👦']);
  assert.deepEqual(chatDisplayLines(entry('superchat', '[¥30] 支持一下')), ['用户甲', '[¥30] 支持一下']);
});

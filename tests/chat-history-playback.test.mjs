import test from 'node:test';
import assert from 'node:assert/strict';
import { CHAT_HISTORY_LIMIT, ChatHistoryPlayback, historyDisplayLines } from '../src/chat-history-playback.ts';

const entry = (kind, body = '终端消息', key = body) => ({ kind, body, key, username: '用户 WHEN', level: 'UL 42', timestamp: new Date(2026, 9, 27, 12, 0, 1).getTime() });

test('history prints sending time, username and level, then body without splitting emoji', () => {
  const playback = new ChatHistoryPlayback(), message = entry('message', '👨‍👩‍👧‍👦好');
  playback.enqueue(message);
  assert.deepEqual(playback.read()[0].lines, ['[2026-10-27 12:00:01]']);
  playback.advance(160);
  assert.deepEqual(playback.read()[0].lines, historyDisplayLines(message).slice(0, 2));
  playback.advance(170);
  assert.deepEqual(playback.read()[0].lines, ['[2026-10-27 12:00:01]', '用户 WHEN · UL 42', '👨‍👩‍👧‍👦']);
  playback.advance(170);
  assert.deepEqual(playback.read()[0].lines, historyDisplayLines(message));
  assert.equal(playback.read()[0].complete, true);
  assert.equal(playback.settled, true);
});

test('ordinary chat, gifts and SC stay together in arrival order with their original content', () => {
  const playback = new ChatHistoryPlayback();
  const entries = [entry('message', '第一条'), entry('gift', '送出 [小花花]'), entry('superchat', '[¥30] 支持'), entry('message', '第二条')];
  entries.forEach(value => playback.enqueue(value));
  playback.advance(10000);
  assert.deepEqual(playback.read().map(row => row.entry), entries);
  assert.deepEqual(playback.read().map(row => row.lines[2]), entries.map(value => value.body));
  assert.equal(new Set(playback.read().map(row => row.id)).size, entries.length);
});

test('history stays bounded at 200 while retaining the newest complete messages', () => {
  const playback = new ChatHistoryPlayback();
  playback.reducedMotion = true;
  for (let index = 0; index < CHAT_HISTORY_LIMIT + 20; index++) playback.enqueue(entry('message', `消息 ${index}`));
  assert.equal(playback.read().length, CHAT_HISTORY_LIMIT);
  assert.equal(playback.read()[0].entry.body, '消息 20');
  assert.equal(playback.read().at(-1).entry.body, '消息 219');
});

test('a busy terminal bounds its pending queue and catches up without losing the latest gift', () => {
  const playback = new ChatHistoryPlayback();
  for (let index = 0; index < 1000; index++) playback.enqueue(entry('message', `消息 ${index}`));
  playback.enqueue(entry('gift', '送出 [最终礼物]'));
  playback.advance(100000);
  assert.equal(playback.settled, true);
  assert.equal(playback.read().length, CHAT_HISTORY_LIMIT);
  assert.equal(playback.read()[0].entry.body, '消息 801');
  assert.equal(playback.read().at(-1).lines[2], '送出 [最终礼物]');
});

test('switching away settles the existing log so switching back needs no stale-message replay', () => {
  const playback = new ChatHistoryPlayback();
  playback.enqueue(entry('message', '已开始打印'));
  playback.advance(170);
  playback.enqueue(entry('gift', '送出 [礼物]'));
  playback.finish();
  playback.enqueue(entry('message', '另一布局期间收到'));
  playback.finish();
  assert.equal(playback.settled, true);
  assert.deepEqual(playback.read().map(row => row.lines[2]), ['已开始打印', '送出 [礼物]', '另一布局期间收到']);
  playback.enqueue(entry('message', '恢复逐字打印'));
  assert.equal(playback.read().length, 4);
  assert.equal(playback.read().at(-1).lines.length, 1);
});

test('reduced motion completes every pending line without delays and preserves the history', () => {
  const playback = new ChatHistoryPlayback();
  playback.enqueue(entry('message', '普通消息'));
  playback.enqueue(entry('gift', '送出 [礼物]'));
  playback.reducedMotion = true; playback.advance(0);
  assert.equal(playback.settled, true);
  assert.ok(playback.read().every(row => row.complete && !row.typing && row.lines.length === 3));
});

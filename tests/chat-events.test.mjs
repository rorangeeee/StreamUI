import test from 'node:test';
import assert from 'node:assert/strict';
import { ChatEventFormatter } from '../src/chat-events.ts';

const base = { origin: 526038, uid: 42, username: '测试观众', timestampNormalized: 1792670400123, id: 'event-1' };

test('chat preserves the sending time and keeps UL and fans medal levels distinct', () => {
  const formatter = new ChatEventFormatter();
  const entry = formatter.format({ ...base, type: 'message', message: '晚上好', userLvl: 23, medal: { name: '测试牌', level: 12 } });
  assert.equal(entry.timestamp, base.timestampNormalized);
  assert.equal(entry.username, base.username);
  assert.equal(entry.level, 'UL 23 · 测试牌 Lv.12');
  assert.equal(entry.body, '晚上好');
  assert.equal(entry.key, '526038:message:event-1');
});

test('gifts reuse only the same user and room UL, never a medal level as UL', () => {
  const formatter = new ChatEventFormatter();
  formatter.format({ ...base, type: 'message', message: '你好', userLvl: 23 });
  const gift = { ...base, type: 'gift', giftName: '小花花', medal: { level: 8, name: '花园' } };
  assert.equal(formatter.format(gift).body, '送出 [小花花]');
  assert.equal(formatter.format(gift).level, 'UL 23 · 花园 Lv.8');
  assert.equal(formatter.format({ ...gift, origin: 99 }).level, 'UL — · 花园 Lv.8');
  assert.equal(formatter.format({ ...gift, uid: 43 }).level, 'UL — · 花园 Lv.8');
});

test('superchat uses normalized currency without multiplying by gift count or guessing raw units', () => {
  const formatter = new ChatEventFormatter();
  const sc = { ...base, type: 'superchat', message: '支持一下', priceNormalized: 30, price: 30000, scAmount: 1 };
  assert.equal(formatter.format(sc).body, '[¥30] 支持一下');
  assert.equal(formatter.format({ ...sc, priceNormalized: 30.5 }).body, '[¥30.5] 支持一下');
  assert.equal(formatter.format({ ...sc, priceNormalized: undefined }).body, '[金额未知] 支持一下');
});

test('control events, unsupported events, deleted SCs and empty messages stay out of the terminal', () => {
  const formatter = new ChatEventFormatter();
  for (const input of [null, [], 'text', { type: 'established' }, { type: 'ping' }, { type: 'interaction' }, { type: 'message', message: '' }, { type: 'superchat', deleted: true }]) {
    assert.equal(formatter.format(input), null);
  }
});

test('legacy timestamps normalize to milliseconds and invalid timestamps use receive time', () => {
  const formatter = new ChatEventFormatter();
  const event = { ...base, timestampNormalized: undefined, type: 'message', message: '时间测试' };
  for (const timestamp of [1700000000, 1700000000000, 1700000000000000, 1700000000000000000]) {
    assert.equal(formatter.format({ ...event, timestamp }).timestamp, 1700000000000);
  }
  assert.equal(formatter.format({ ...event, timestamp: NaN }, 1700000000123).timestamp, 1700000000123);
});

test('multiline upstream content stays in one logical terminal row', () => {
  const formatter = new ChatEventFormatter();
  const entry = formatter.format({ ...base, type: 'message', username: '名字\n第二行', message: '<img src=x onerror=alert(1)>\r\n下一行' });
  assert.equal(entry.username, '名字 第二行');
  assert.equal(entry.body, '<img src=x onerror=alert(1)> 下一行');
});

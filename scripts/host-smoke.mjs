import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { decodeAudioFrame } from '../src/audio-protocol.ts';

// Run against the isolated instance created by test-host.ps1; never changes the user's OBS host.
const [obsUrl, configUrl, dataDirectory] = process.argv.slice(2);
if (!obsUrl || !configUrl || !dataDirectory) throw new Error('Use npm run host:test.');
const checks = [];
const check = (condition, name) => { assert.ok(condition, name); checks.push(name); };
const request = async (path, method = 'GET', body) => {
  const result = await fetch(new URL(path, configUrl), { method, headers: { 'Content-Type': 'application/json', 'X-StreamUI-Request': '1' }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
  assert.ok(result.ok, `${method} ${path}: ${result.status} ${result.ok ? '' : await result.text()}`);
  return result.headers.get('content-type')?.includes('application/json') ? result.json() : null;
};
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function eventually(predicate, timeout = 10000) {
  const until = Date.now() + timeout;
  do { if (await predicate()) return; await delay(80); } while (Date.now() < until);
  throw new Error('Timed out waiting for the host state.');
}
function socket(path, base = obsUrl) {
  const url = new URL(path, base); url.protocol = 'ws:';
  const ws = new WebSocket(url); ws.binaryType = 'arraybuffer';
  const messages = []; const waiters = [];
  ws.onmessage = event => { messages.push(event.data); for (const wake of waiters.splice(0)) wake(); };
  return {
    ws,
    async next(predicate) {
      const until = Date.now() + 10000;
      while (Date.now() < until) {
        const index = messages.findIndex(predicate);
        if (index >= 0) return messages.splice(index, 1)[0];
        await Promise.race([new Promise(resolve => waiters.push(resolve)), delay(100)]);
      }
      throw new Error(`WebSocket timed out: ${path}`);
    },
  };
}

// A minimal local WebSocket producer emulates the documented LAPLACE protocol,
// including masked client pong messages, without posting test events to a live bridge.
const upstreamClients = new Set();
let authSeen = false, pongSeen = false;
function send(ws, object) {
  const body = Buffer.from(JSON.stringify(object));
  const header = body.length < 126 ? Buffer.from([0x81, body.length]) : Buffer.from([0x81, 126, body.length >> 8, body.length & 255]);
  ws.write(Buffer.concat([header, body]));
}
const upstream = createServer();
upstream.on('upgrade', (req, ws) => {
  authSeen = new URL(req.url, 'http://localhost').searchParams.get('token') === 'host-test-token';
  const accept = createHash('sha1').update(req.headers['sec-websocket-key'] + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
  ws.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\nSec-WebSocket-Protocol: laplace-event-bridge-role-client\r\n\r\n`);
  upstreamClients.add(ws);
  ws.on('close', () => upstreamClients.delete(ws)); ws.on('error', () => {});
  let pending = Buffer.alloc(0);
  ws.on('data', bytes => {
    pending = Buffer.concat([pending, bytes]);
    while (pending.length >= 6) {
      const opcode = pending[0] & 15;
      let length = pending[1] & 127, offset = 2;
      if (length === 126) { if (pending.length < 8) return; length = pending.readUInt16BE(2); offset = 4; }
      if (length === 127 || !(pending[1] & 128)) return;
      if (pending.length < offset + 4 + length) return;
      const mask = pending.subarray(offset, offset + 4);
      const body = Buffer.from(pending.subarray(offset + 4, offset + 4 + length));
      for (let i = 0; i < body.length; i++) body[i] ^= mask[i % 4];
      pending = pending.subarray(offset + 4 + length);
      if (opcode === 1) {
        try { const json = JSON.parse(body); if (json.type === 'pong' && json.respondingTo === 123) pongSeen = true; } catch { }
      } else if (opcode === 8) { ws.destroy(); return; }
    }
  });
  send(ws, { type: 'established', clientId: 'smoke-test', version: '4.0.2' });
  send(ws, { type: 'ping', timestamp: 123 });
});
await new Promise(resolve => upstream.listen(0, '127.0.0.1', resolve));
const upstreamPort = upstream.address().port;
const sockets = [];
try {
  await eventually(async () => (await fetch(new URL('/api/state', configUrl)).catch(() => null))?.ok);
  const original = await request('/api/settings');
  const obsHtml = await fetch(obsUrl).then(r => r.text());
  const configHtml = await fetch(configUrl).then(r => r.text());
  check(obsHtml.includes('id="workspace"') && !obsHtml.includes('settings-form'), 'OBS port serves only the display');
  check(configHtml.includes('settings-form') && configHtml.includes('tab-layout'), 'configuration port serves three tabs');
  check((await fetch(new URL('/api/settings', obsUrl))).status === 404, 'OBS cannot read secret configuration');
  check((await fetch(new URL('/api/settings', configUrl), { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(original) })).status === 403, 'mutations require the application header');
  check((await fetch(new URL('/api/state', obsUrl), { headers: { Origin: 'https://example.com' } })).status === 403, 'foreign origins cannot access host data');
  const events = socket('/ws/events'); sockets.push(events.ws);
  const state = JSON.parse(await events.next(data => typeof data === 'string' && JSON.parse(data).type === 'state'));
  check(state.data.config.laplace.token === '', 'OBS state never includes the LAPLACE token');
  const devices = await request('/api/audio/devices');
  check(Array.isArray(devices), 'audio device enumeration endpoint');
  if (devices.length) {
    await request('/api/settings', 'PUT', { ...original, audio: { ...original.audio, enabled: true } });
    const audio = socket('/ws/audio'); sockets.push(audio.ws);
    const binary = await audio.next(data => data instanceof ArrayBuffer);
    const decoded = decodeAudioFrame(binary);
    check(decoded?.waveform.length === 8192 && decoded.sampleRate === 48000, '48 kHz WASAPI analysis reaches a browser socket');
    await request('/api/settings', 'PUT', { ...original, audio: { ...original.audio, enabled: false } });
    await eventually(async () => (await request('/api/state')).audio.state === 'idle');
    check(true, 'audio can be stopped without browser interaction');
  }
  const titles = { english: ['LIVE', 'AFTER HOURS'], chinese: ['直播中', '深夜电台'] };
  await request('/api/settings', 'PUT', { ...original, titles });
  check(JSON.stringify((await request('/api/state')).config.titles) === JSON.stringify(titles), 'English and Chinese title lists are configurable independently');
  const ids = ['stream-window', 'spectrogram-window', 'waveform-window', 'chat-window', 'wordmark-window', 'wordmark-blur-window'];
  const layout = { order: [...ids].reverse(), windows: Object.fromEntries(ids.map((id, i) => [id, { x: .05, y: .05 + i * .1, width: .4, height: .12, angle: i * 5, inverted: i === 2 }])) };
  await request('/api/layout', 'PUT', layout);
  check(JSON.stringify((await request('/api/state')).config.layout) === JSON.stringify(layout), 'layout updates reach the OBS state');
  const saved = JSON.parse(await readFile(new URL('settings.json', `file:///${dataDirectory.replaceAll('\\', '/')}/`), 'utf8'));
  check(JSON.stringify(saved.layout) === JSON.stringify(layout), 'layout is persisted to disk');
  const staleSettings = { ...original, laplace: { enabled: true, url: `ws://127.0.0.1:${upstreamPort}`, token: 'host-test-token', startLocalBridge: false }, layout: null };
  await request('/api/settings', 'PUT', staleSettings);
  check((await request('/api/state')).config.layout !== null, 'stale settings forms cannot overwrite a newer layout');
  await eventually(async () => (await request('/api/state')).laplace.state === 'connected' && authSeen && pongSeen);
  check(true, 'LAPLACE authenticates and answers application heartbeats');
  const chat = { type: 'message', origin: 'test', id: 'host-smoke', username: 'Host test', message: 'local relay test', timestamp: Date.now(), userLvl: 1 };
  for (const ws of upstreamClients) send(ws, chat);
  const relayed = JSON.parse(await events.next(data => typeof data === 'string' && JSON.parse(data).type === 'chat'));
  check(relayed.data.message === chat.message, 'LAPLACE events are relayed to OBS');
  for (const ws of upstreamClients) ws.destroy();
  await eventually(async () => (await request('/api/state')).laplace.state === 'connected' && upstreamClients.size > 0, 15000);
  check(true, 'LAPLACE reconnects after an upstream disconnect');
  await request('/api/settings', 'PUT', { ...original, laplace: { ...original.laplace, enabled: false } });
  console.log(JSON.stringify({ passed: checks }, null, 2));
} finally {
  for (const ws of sockets) ws.close();
  for (const ws of upstreamClients) ws.destroy();
  upstream.close();
}

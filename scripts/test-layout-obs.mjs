// Run against an isolated StreamUI host. This mock never connects to the user's OBS.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { defaultStageLayout } from '../src/stage-layout.ts';

const base = process.argv[2] ?? 'http://127.0.0.1:5241';
const checks = [];
const check = (value, message) => { assert.ok(value, message); checks.push(message); };
async function request(path, method = 'GET', body) {
  const result = await fetch(new URL(path, base), { method, headers: { 'Content-Type': 'application/json', 'X-StreamUI-Request': '1' }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
  assert.ok(result.ok, `${method} ${path}: ${result.status}`);
  return result.headers.get('content-type')?.includes('application/json') ? result.json() : null;
}
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function eventually(predicate, label) {
  const end = Date.now() + 12000;
  do { if (await predicate()) return; await delay(50); } while (Date.now() < end);
  throw new Error(`Timed out: ${label}`);
}
const hash = text => createHash('sha256').update(text).digest('base64');
const password = 'local-mock-obs-password', salt = 'test-salt', challenge = 'test-challenge';
const clients = new Set();
let scene = '游戏现场', identifies = 0, queries = 0, invalidAuth = 0;
function frame(ws, value, opcode = 1) {
  const body = Buffer.isBuffer(value) ? value : Buffer.from(JSON.stringify(value));
  const header = body.length < 126 ? Buffer.from([0x80 | opcode, body.length]) : Buffer.from([0x80 | opcode, 126, body.length >> 8, body.length & 255]);
  ws.write(Buffer.concat([header, body]));
}
function program(name, type = 'CurrentProgramSceneChanged') {
  if (type === 'CurrentProgramSceneChanged') scene = name;
  for (const ws of clients) frame(ws, { op: 5, d: { eventType: type, eventIntent: 4, eventData: { sceneName: name } } });
}
const mock = createServer();
mock.on('upgrade', (req, ws) => {
  const accept = createHash('sha1').update(req.headers['sec-websocket-key'] + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
  ws.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
  clients.add(ws); ws.on('close', () => clients.delete(ws)); ws.on('end', () => ws.end()); ws.on('error', () => {});
  let pending = Buffer.alloc(0);
  ws.on('data', bytes => {
    pending = Buffer.concat([pending, bytes]);
    while (pending.length >= 6) {
      let length = pending[1] & 127, offset = 2;
      const opcode = pending[0] & 15;
      if (length === 126) { if (pending.length < 8) return; length = pending.readUInt16BE(2); offset = 4; }
      if (length === 127 || !(pending[1] & 128) || pending.length < offset + 4 + length) return;
      const mask = pending.subarray(offset, offset + 4), body = Buffer.from(pending.subarray(offset + 4, offset + 4 + length));
      for (let i = 0; i < body.length; i++) body[i] ^= mask[i % 4];
      pending = pending.subarray(offset + 4 + length);
      if (opcode === 8) { ws.destroy(); return; }
      if (opcode === 9) { frame(ws, body, 10); continue; }
      if (opcode !== 1) continue;
      const message = JSON.parse(body);
      if (message.op === 1) {
        identifies++;
        if (message.d.authentication !== hash(hash(password + salt) + challenge)) {
          invalidAuth++; const close = Buffer.alloc(2); close.writeUInt16BE(4009); frame(ws, close, 8); ws.end(); continue;
        }
        assert.equal(message.d.eventSubscriptions & 4, 4);
        frame(ws, { op: 2, d: { negotiatedRpcVersion: 1 } });
      } else if (message.op === 6) {
        assert.equal(message.d.requestType, 'GetCurrentProgramScene'); queries++;
        frame(ws, { op: 7, d: { requestType: message.d.requestType, requestId: message.d.requestId,
          requestStatus: { result: true, code: 100 }, responseData: { currentProgramSceneName: scene } } });
      }
    }
  });
  frame(ws, { op: 0, d: { rpcVersion: 1, authentication: { salt, challenge } } });
});
await new Promise(resolve => mock.listen(0, '127.0.0.1', resolve));
const obs = { url: `ws://127.0.0.1:${mock.address().port}`, password, scene21: '超宽现场', scene16: '游戏现场' };
const original = await request('/api/settings');
try {
  const legacy = defaultStageLayout('21:9'); legacy.windows['chat-window'].x -= .02;
  const wide = defaultStageLayout('16:9'); wide.windows['wordmark-blur-window'].x = .03;
  await request('/api/layout-mode', 'PUT', { mode: '21:9' });
  await request('/api/layout', 'PUT', { mode: '21:9', layout: legacy });
  await request('/api/layout-mode', 'PUT', { mode: '16:9' });
  await request('/api/layout', 'PUT', { mode: '16:9', layout: wide });
  await request('/api/layout-mode', 'PUT', { mode: '21:9' });
  check(JSON.stringify((await request('/api/state')).config.layout) === JSON.stringify(legacy), 'manual switching restores the edited 21:9 profile');
  wide.windows['wordmark-blur-window'].x = .04;
  await request('/api/layout', 'PUT', { mode: '16:9', layout: wide });
  check((await request('/api/state')).config.layoutMode === '21:9', 'late saves do not change the active layout');
  await request('/api/layout-mode', 'PUT', { mode: '16:9' });
  check((await request('/api/state')).config.layout.windows['wordmark-blur-window'].x === .04, 'late saves update only their own profile');
  const stale = await request('/api/settings');
  await request('/api/layout-mode', 'PUT', { mode: '21:9' });
  await request('/api/settings', 'PUT', stale);
  check((await request('/api/state')).config.layoutMode === '21:9', 'stale settings forms preserve current layout selection');
  await request('/api/settings', 'PUT', { ...original, obs });
  await eventually(async () => (await request('/api/state')).config.layoutMode === '16:9', 'initial scene');
  check(identifies > 0 && queries > 0, 'OBS v5 challenge authentication and initial program query succeed');
  const publicState = await request('/api/state');
  check(publicState.config.obs.password === '' && !JSON.stringify(publicState).includes(password), 'public display state never contains the OBS password');
  check((await request('/api/settings')).obs.password === password, 'OBS password persists on the configuration port');
  program('超宽现场', 'CurrentPreviewSceneChanged'); await delay(150);
  check((await request('/api/state')).config.layoutMode === '16:9', 'studio preview scenes cannot trigger a switch');
  program('超宽现场');
  await eventually(async () => (await request('/api/state')).config.layoutMode === '21:9', '21:9 scene');
  program('其他场景'); await delay(150);
  check((await request('/api/state')).config.layoutMode === '21:9', 'unmatched scenes retain the selected layout');
  program('游戏现场');
  await eventually(async () => (await request('/api/state')).config.layoutMode === '16:9', '16:9 scene');
  check(true, 'both named program scenes select their respective layout');
  await request('/api/layout-mode', 'PUT', { mode: '21:9' });
  await request('/api/settings', 'PUT', { ...original, obs: { ...obs, scene16: '' } });
  await eventually(async () => (await request('/api/state')).obs.scene === '游戏现场', 'partial mapping reconnect');
  check((await request('/api/state')).config.layoutMode === '21:9', 'a blank target name disables only that mapping');
  await request('/api/settings', 'PUT', { ...original, obs });
  await eventually(async () => (await request('/api/state')).config.layoutMode === '16:9', 'mapping restore');
  scene = '超宽现场'; for (const ws of clients) ws.destroy();
  await eventually(async () => (await request('/api/state')).config.layoutMode === '21:9', 'reconnect');
  check(true, 'OBS reconnect re-authenticates and resynchronizes the program scene');
  await request('/api/settings', 'PUT', { ...original, obs: { ...obs, password: 'wrong' } });
  await eventually(async () => (await request('/api/state')).obs.state === 'reconnecting' && invalidAuth > 0, 'authentication error');
  check(Boolean((await request('/api/state')).obs.error), 'authentication failures expose a recoverable connection status');
  await request('/api/settings', 'PUT', { ...original, obs: { ...obs, scene21: '', scene16: '' } });
  await eventually(() => clients.size === 0, 'disabled listener');
  check((await request('/api/state')).obs.state === 'disabled', 'both blank names disconnect and disable the listener');
  const ambiguous = await fetch(new URL('/api/settings', base), { method: 'PUT', headers: { 'Content-Type': 'application/json', 'X-StreamUI-Request': '1' }, body: JSON.stringify({ ...original, obs: { ...obs, scene16: obs.scene21 } }) });
  check(ambiguous.status === 400, 'duplicate scene mappings are rejected');
  console.log(JSON.stringify({ passed: checks }, null, 2));
} finally {
  await request('/api/settings', 'PUT', { ...original, obs: { ...original.obs, scene21: '', scene16: '' } });
  for (const ws of clients) ws.destroy();
  await new Promise(resolve => mock.close(resolve));
}

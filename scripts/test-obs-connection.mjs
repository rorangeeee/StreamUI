// Builds and tests only ObsSceneService as a console client; never starts Host.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createInterface } from 'node:readline';
import { readdir, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
const directory = path.resolve('.local/obs-connection-qa');
await mkdir(directory, { recursive: true });
const dotnetRoot = path.join(process.env.ProgramFiles, 'dotnet');
const latest = async directory => (await readdir(directory)).sort((a, b) => a.localeCompare(b, undefined, { numeric: true })).at(-1);
const sdk = await latest(path.join(dotnetRoot, 'sdk'));
const referenceVersion = await latest(path.join(dotnetRoot, 'packs/Microsoft.NETCore.App.Ref'));
const references = path.join(dotnetRoot, 'packs/Microsoft.NETCore.App.Ref', referenceVersion, 'ref/net10.0');
const output = path.join(directory, 'ObsConnectionProbe.dll');
const response = ['-nologo', '-target:exe', '-nullable:enable', '-langversion:preview', `-out:"${output}"`,
  ...(await readdir(references)).filter(name => name.endsWith('.dll')).map(name => `-r:"${path.join(references, name)}"`),
  ...['host/ObsSceneService.cs', 'host/Settings.cs', 'tests/ObsConnectionProbe.cs'].map(file => `"${path.resolve(file)}"`)];
const responsePath = path.join(directory, 'compile.rsp');
await writeFile(responsePath, response.join('\n'));
const compiler = spawn('dotnet', [path.join(dotnetRoot, 'sdk', sdk, 'Roslyn/bincore/csc.dll'), `@${responsePath}`], { stdio: 'inherit', windowsHide: true });
assert.equal((await once(compiler, 'exit'))[0], 0, 'connection probe compilation');
await writeFile(path.join(directory, 'ObsConnectionProbe.runtimeconfig.json'), JSON.stringify({ runtimeOptions: { tfm: 'net10.0', framework: { name: 'Microsoft.NETCore.App', version: '10.0.0' } } }));
if (process.argv.includes('--compile-only')) { console.log('Compiled OBS connection client without starting Host.'); process.exit(0); }
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const checks = [];
const check = (value, name) => { assert.ok(value, name); checks.push(name); console.log(`PASS ${name}`); };
const hash = value => createHash('sha256').update(value).digest('base64');
async function mock(name) {
  const sockets = new Set(), connections = new Set();
  const state = { hello: true, identify: true, answer: true, password: 'test-password', scene: name, queries: 0, connections: 0, replyDelay: 0, replyMode: 'legacy', earlyEvent: false };
  const frame = (socket, data, opcode = 1) => {
    const body = Buffer.isBuffer(data) ? data : Buffer.from(JSON.stringify(data));
    const header = body.length < 126 ? Buffer.from([0x80 | opcode, body.length]) : Buffer.from([0x80 | opcode, 126, body.length >> 8, body.length & 255]);
    socket.write(Buffer.concat([header, body]));
  };
  const server = createServer();
  server.on('connection', socket => { connections.add(socket); socket.on('close', () => connections.delete(socket)); });
  server.on('upgrade', (request, socket) => {
    const accept = createHash('sha1').update(request.headers['sec-websocket-key'] + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
    socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
    sockets.add(socket); state.connections++;
    socket.on('error', () => {}); socket.on('close', () => sockets.delete(socket)); socket.on('end', () => socket.end());
    let pending = Buffer.alloc(0);
    socket.on('data', bytes => {
      pending = Buffer.concat([pending, bytes]);
      while (pending.length >= 6) {
        let length = pending[1] & 127, offset = 2;
        if (length === 126) { if (pending.length < 8) return; length = pending.readUInt16BE(2); offset = 4; }
        if (length === 127 || !(pending[1] & 128) || pending.length < offset + 4 + length) return;
        const opcode = pending[0] & 15, mask = pending.subarray(offset, offset + 4), body = Buffer.from(pending.subarray(offset + 4, offset + 4 + length));
        for (let index = 0; index < body.length; index++) body[index] ^= mask[index % 4];
        pending = pending.subarray(offset + 4 + length);
        if (opcode === 8) { socket.destroy(); return; }
        if (opcode === 9) { frame(socket, body, 10); continue; }
        if (opcode !== 1) continue;
        const message = JSON.parse(body);
        if (message.op === 1) {
          if (!state.identify) continue;
          if (message.d.authentication !== hash(hash(state.password + 'salt') + 'challenge')) {
            const close = Buffer.alloc(2); close.writeUInt16BE(4009); frame(socket, close, 8); socket.end(); continue;
          }
          assert.equal(message.d.eventSubscriptions, 22);
          if (state.earlyEvent) frame(socket, { op: 5, d: { eventType: 'CurrentProgramSceneChanged', eventData: { sceneName: state.scene } } });
          frame(socket, { op: 2, d: { negotiatedRpcVersion: 1 } });
        } else if (message.op === 6) {
          assert.equal(message.d.requestType, 'GetCurrentProgramScene'); state.queries++;
          if (!state.answer) continue;
          const responseData = state.replyMode === 'modern' ? { sceneName: state.scene } : state.replyMode === 'mixed' ? { sceneName: null, currentProgramSceneName: state.scene }
            : state.replyMode === 'empty' ? { sceneName: null, currentProgramSceneName: null } : { currentProgramSceneName: state.scene };
          const requestStatus = state.replyMode === 'rejected' ? { result: false, code: 207, comment: 'OBS warming up' } : { result: true, code: 100 };
          const response = { op: 7, d: { requestType: message.d.requestType, requestId: message.d.requestId, requestStatus, responseData } };
          setTimeout(() => { if (!socket.destroyed) frame(socket, response); }, state.replyDelay);
        }
      }
    });
    if (state.hello) frame(socket, { op: 0, d: { rpcVersion: 1, authentication: { salt: 'salt', challenge: 'challenge' } } });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return { state, url: `ws://127.0.0.1:${server.address().port}`, emit(type, eventData) { for (const socket of sockets) frame(socket, { op: 5, d: { eventType: type, eventData } }); },
    async close() {
      if (!server.listening) return;
      const closed = new Promise(resolve => server.close(resolve));
      for (const socket of connections) socket.destroy();
      await closed;
    } };
}
const first = await mock('Wide'), second = await mock('Game');
const client = spawn('dotnet', [output], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
const clientExit = once(client, 'exit');
const messages = []; let stderr = '';
client.stderr.on('data', data => stderr += data);
createInterface({ input: client.stdout }).on('line', line => { messages.push(JSON.parse(line)); });
const status = () => messages.filter(message => message.type === 'status').at(-1)?.data;
const configure = (server, password = server.state.password) => client.stdin.write(JSON.stringify({ url: server.url, password, scene21: 'Wide', scene16: 'Game' }) + '\n');
async function eventually(predicate, label, timeout = 5000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) { if (predicate()) return; await delay(15); }
  throw new Error(`Timed out: ${label}; last status ${JSON.stringify(status())}; stderr ${stderr}`);
}
let noise;
try {
  configure(first);
  await eventually(() => status()?.state === 'connected' && status().scene === 'Wide', 'initial connection');
  check(true, 'connection is ready only after OBS responds with the current scene');
  await eventually(() => first.state.queries >= 2, 'health probe');
  check(true, 'an idle healthy connection is checked with a read-only request');
  first.state.replyMode = 'modern'; configure(first);
  await eventually(() => status()?.state === 'connected', 'modern scene fields');
  check(status().scene === 'Wide', 'current OBS sceneName responses are supported');
  first.state.replyMode = 'mixed'; configure(first);
  await eventually(() => status()?.state === 'connected', 'nullable modern scene fields');
  check(status().scene === 'Wide', 'a null modern scene field falls back to the valid legacy scene name');
  first.state.replyMode = 'empty'; configure(first);
  await eventually(() => status()?.state === 'reconnecting' && status().error?.includes('未返回有效'), 'empty scene response');
  check(true, 'an empty scene response reports an actionable error instead of a false connected state');
  first.state.replyMode = 'rejected'; configure(first);
  await eventually(() => status()?.state === 'reconnecting' && status().error?.includes('OBS warming up'), 'rejected scene request');
  check(true, 'a protocol rejection is caught and retried instead of terminating the connection task');
  first.state.replyMode = 'legacy'; first.state.earlyEvent = true; configure(first);
  await eventually(() => status()?.state === 'connected', 'early event during authentication');
  check(true, 'an early event during authentication does not masquerade as a wrong password');
  first.state.earlyEvent = false;

  first.state.answer = false;
  const before = messages.length;
  configure(first);
  await eventually(() => first.state.connections >= 2 && messages.slice(before).some(message => message.data?.detail?.includes('读取')), 'authenticated but waiting');
  check(!messages.slice(before).some(message => message.data?.state === 'connected'), 'authentication without scene responses never reports a false connected state');
  await eventually(() => status()?.state === 'reconnecting' && status().error?.includes('超时'), 'initial response timeout');
  check(true, 'unanswered initial requests time out and trigger automatic reconnect');
  first.state.answer = true;
  await eventually(() => status()?.state === 'connected', 'initial timeout recovery');
  check(true, 'a temporarily unresponsive OBS reconnects automatically once responsive');

  first.state.answer = false;
  noise = setInterval(() => first.emit('IgnoredEvent', {}), 25);
  await eventually(() => status()?.state === 'reconnecting' && status().error?.includes('超时'), 'busy response timeout');
  check(true, 'health requests time out even while other events keep arriving');
  clearInterval(noise); noise = null; first.state.answer = true;
  await eventually(() => status()?.state === 'connected', 'health recovery');
  check(true, 'the connection recovers after a live socket stops answering requests');

  first.state.hello = false;
  configure(first);
  await eventually(() => status()?.state === 'reconnecting' && status().error?.includes('协议握手超时'), 'hello timeout');
  check(true, 'a socket that never sends Hello exposes a specific handshake timeout');
  first.state.hello = true; first.state.identify = false;
  configure(first);
  await eventually(() => status()?.state === 'reconnecting' && status().error?.includes('身份验证超时'), 'identify timeout');
  check(true, 'a stalled authentication exposes a distinct authentication timeout');
  first.state.identify = true;
  configure(first, 'wrong-password');
  await eventually(() => status()?.state === 'reconnecting' && status().error?.includes('密码不正确'), 'wrong password');
  check(true, 'an explicit OBS authentication rejection is identified correctly');

  first.state.hello = false; configure(first); await delay(60);
  configure(second);
  await eventually(() => status()?.state === 'connected' && status().scene === 'Game', 'replace pending connection');
  const goodIndex = messages.length;
  await delay(750);
  check(status().state === 'connected' && status().scene === 'Game' && !messages.slice(goodIndex).some(message => message.data?.state === 'reconnecting'),
    'canceling an old handshake cannot overwrite a new healthy connection status');

  second.state.replyDelay = 150; second.state.scene = 'Old';
  configure(second);
  await eventually(() => status()?.detail?.includes('读取'), 'pending delayed scene');
  second.state.scene = 'New'; second.emit('CurrentProgramSceneChanged', { sceneName: 'New' });
  await eventually(() => status()?.scene === 'New', 'newer scene event');
  await delay(220);
  check(status().scene === 'New', 'a stale initial response cannot roll back a newer scene event');
  second.state.replyDelay = 0;
  const transitionStart = messages.length;
  second.emit('SceneTransitionStarted', { transitionName: 'Delay' });
  await eventually(() => status()?.transition?.phase === 'started', 'transition start');
  const identity = status().transition.id;
  second.emit('SceneTransitionEnded', { transitionName: 'Delay' });
  second.emit('SceneTransitionVideoEnded', { transitionName: 'Delay' });
  await eventually(() => status()?.transition?.phase === 'video-ended', 'transition end');
  check(status().transition.id === identity && messages.slice(transitionStart).filter(message => message.data?.transition?.phase === 'started').every(message => message.data.transition.id === identity),
    'transition start and end keep one identity across health checks');

  await first.close();
  configure(first);
  await eventually(() => status()?.state === 'reconnecting' && /OBS 连接(?:失败|超时)/u.test(status().error ?? ''), 'connection refused');
  check(true, 'connection failures expose the underlying stage and error instead of a generic password warning');
  configure(second);
  await eventually(() => status()?.state === 'connected', 'manual reconnect');
  check(true, 'reconnecting with saved working settings restores a healthy session');
  await writeFile(path.join(directory, 'report.json'), JSON.stringify({ checks }, null, 2));
} finally {
  if (noise) clearInterval(noise);
  client.stdin.end();
  const timeout = setTimeout(() => client.kill(), 3000);
  await clientExit; clearTimeout(timeout);
  await second.close();
  await first.close().catch(() => {});
}
assert.equal(stderr, '');
console.log(`Completed ${checks.length} OBS client checks without starting Host.`);

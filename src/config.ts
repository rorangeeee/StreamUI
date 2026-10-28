import './config.css';
import { createClient, request } from './sdk/client.ts';
import type { CoreSettings, PublicState, SceneSlot, PluginInfo, ChatMessage } from './sdk/contracts.ts';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id)! as T;
const input = (id: string) => $<HTMLInputElement>(id);
const client = createClient();
let settings: CoreSettings | null = null;
let selectedId: string | null = null;
let sceneDirty = false, lastSceneList = '', lastPlugins = '', panelPlugin = '';
let toastTimer: ReturnType<typeof setTimeout> | undefined;
const titles: Record<string, string> = { scenes: '场景', obs: 'OBS', chat: '弹幕', plugins: '插件', settings: '设置' };

function toast(message: string, error = false): void {
  const box = $('feedback'); box.textContent = message; box.dataset.error = String(error); box.hidden = false;
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => box.hidden = true, error ? 7000 : 2400);
}
function failure(error: unknown): void { toast((error as Error).message, true); }
function currentScene(): SceneSlot | undefined { return client.state?.scenes.find(scene => scene.id === selectedId); }
function section(name: string): void {
  document.querySelectorAll<HTMLElement>('.view').forEach(view => view.hidden = view.id !== 'view-' + name);
  document.querySelectorAll<HTMLButtonElement>('[data-section]').forEach(button => {
    if (button.dataset.section === name) button.setAttribute('aria-current', 'page'); else button.removeAttribute('aria-current');
  });
  $('page-title').textContent = titles[name]; $('scene-actions').hidden = name !== 'scenes';
}
document.querySelectorAll<HTMLButtonElement>('[data-section]').forEach(button => button.onclick = () => section(button.dataset.section!));

function fitPreview(): void {
  const scene = currentScene(); if (!scene) return;
  const viewport = $('stage-viewport'), frame = $<HTMLIFrameElement>('output-frame');
  viewport.style.aspectRatio = scene.width + '/' + scene.height;
  Object.assign(frame.style, { width: scene.width + 'px', height: scene.height + 'px', transform: 'scale(' + Math.min(viewport.clientWidth / scene.width, viewport.clientHeight / scene.height) + ')' });
}
new ResizeObserver(fitPreview).observe($('stage-viewport'));
function preview(): void {
  const scene = currentScene(), state = client.state;
  $('scene-form').hidden = !scene;
  if (!scene || !state) {
    $<HTMLIFrameElement>('output-frame').removeAttribute('src'); $('preview-title').textContent = '预览'; return;
  }
  $('preview-title').textContent = scene.name;
  $('scene-resolution').textContent = scene.width + ' × ' + scene.height;
  const url = new URL(state.outputUrl); url.searchParams.set('scene', scene.id); url.searchParams.set('preview', '1');
  const frame = $<HTMLIFrameElement>('output-frame'); if (frame.src !== url.href) frame.src = url.href;
  $('activate-scene').toggleAttribute('disabled', !client.connected || state.scene.activeId === scene.id);
  const custom = $<HTMLIFrameElement>('scene-config-frame');
  $('scene-custom-panel').hidden = !scene.settingsPage;
  if (scene.settingsPage) { const page = new URL('/user/' + scene.settingsPage, location.origin); page.searchParams.set('streamuiScene', scene.id); const src = page.href; if (custom.src !== src) custom.src = src; } else custom.removeAttribute('src');
  fitPreview();
}
function fillScene(): void {
  const scene = currentScene(); if (!scene) return;
  input('scene-name').value = scene.name; input('scene-entry').value = scene.entry; input('scene-obs').value = scene.obsScene;
  input('scene-width').value = String(scene.width); input('scene-height').value = String(scene.height);
  input('scene-transition').value = scene.transition; input('scene-settings-page').value = scene.settingsPage;
  sceneDirty = false;
}
function drawScenes(): void {
  const state = client.state; if (!state) return;
  if (!state.scenes.some(scene => scene.id === selectedId)) { selectedId = state.scene.activeId ?? state.scenes[0]?.id ?? null; fillScene(); }
  const signature = JSON.stringify([state.scenes, state.scene.activeId, selectedId]);
  if (signature !== lastSceneList) {
    lastSceneList = signature;
    const nodes = state.scenes.map(scene => {
      const button = document.createElement('button'); button.type = 'button'; button.className = 'scene-item';
      button.setAttribute('aria-selected', String(scene.id === selectedId));
      const icon = document.createElement('span'); icon.className = 'scene-icon'; icon.textContent = scene.name.slice(0, 1);
      const copy = document.createElement('span'), name = document.createElement('div'); name.className = 'scene-item-name'; name.textContent = scene.name; copy.append(name);
      if (state.scene.activeId === scene.id) { const status = document.createElement('div'); status.className = 'scene-item-state'; status.textContent = '正在输出'; copy.append(status); }
      button.append(icon, copy);
      button.onclick = () => { selectedId = scene.id; fillScene(); drawScenes(); preview(); };
      return button;
    });
    $('scene-list').replaceChildren(...nodes);
  }
  if (!sceneDirty) fillScene();
  preview();
}
function fillAwayOptions(): void {
  if (!settings) return;
  const picker = $<HTMLSelectElement>('away-scene');
  picker.replaceChildren(new Option('未选择', ''), ...settings.scenes.map(scene => new Option(scene.name, scene.id)));
  picker.value = settings.away.sceneId ?? '';
}
function status(id: string, value: string, live: boolean): void { $(id).textContent = value; $(id).dataset.live = String(live); }
function serviceError(id: string, value: string | null): void { $(id).hidden = !value; $(id).textContent = value ?? ''; }
function sync(): void {
  const state = client.state;
  $('host-dot').dataset.live = String(client.connected);
  $('host-status').textContent = client.connected ? '已连接' : '未连接';
  $('add-scene').toggleAttribute('disabled', !client.connected);
  if (!state) return;
  const away = $('away-button') as HTMLButtonElement;
  away.textContent = state.scene.away ? '返回' : '暂离'; away.dataset.active = String(state.scene.away);
  away.disabled = !client.connected || !state.scene.awaySceneId;
  input('startup-enabled').checked = state.startup;
  if (settings) { settings.scenes = state.scenes; settings.selectedSceneId = state.scene.selectedId; settings.away.enabled = state.scene.away; }
  const names: Record<string, string> = { connected: '已连接', disabled: '已停用', disconnected: '已停用', connecting: '连接中', reconnecting: '重新连接中' };
  status('obs-status', client.connected ? names[state.obs.state] ?? state.obs.state : '未连接', client.connected && state.obs.state === 'connected');
  $('obs-current').textContent = state.obs.scene ?? '—'; serviceError('obs-error', state.obs.error);
  status('chat-status', client.connected ? names[state.chat.state] ?? state.chat.state : '未连接', client.connected && state.chat.state === 'connected');
  $('chat-count').textContent = String(state.chat.events); serviceError('chat-error', state.chat.error);
  drawScenes(); drawPlugins();
}
async function loadSettings(fill = false): Promise<void> {
  settings = await request<CoreSettings>('/api/settings');
  if (fill) {
    input('obs-enabled').checked = settings.obs.enabled; input('obs-url').value = settings.obs.url; input('obs-password').value = settings.obs.password;
    input('chat-enabled').checked = settings.laplace.enabled; input('chat-url').value = settings.laplace.url; input('chat-token').value = settings.laplace.token;
    input('chat-local').checked = settings.laplace.startLocalBridge;
  }
  fillAwayOptions();
}
async function save(next: CoreSettings): Promise<void> {
  await request('/api/settings', 'PUT', next); await loadSettings(); toast('已保存');
}
$('scene-form').oninput = () => { sceneDirty = true; };
$('scene-form').onsubmit = event => {
  event.preventDefault(); if (!settings) return;
  const updated = { ...currentScene()!, name: input('scene-name').value.trim(), entry: input('scene-entry').value.trim(), obsScene: input('scene-obs').value.trim(),
    width: Number(input('scene-width').value), height: Number(input('scene-height').value),
    transition: input('scene-transition').value.trim(), settingsPage: input('scene-settings-page').value.trim() };
  void save({ ...settings, scenes: settings.scenes.map(scene => scene.id === updated.id ? updated : scene) }).then(() => { sceneDirty = false; fillScene(); }).catch(failure);
};
$('add-scene').onclick = async () => {
  try { const scene = await request<SceneSlot>('/api/scenes', 'POST', { name: '新场景' }); selectedId = scene.id; await loadSettings(); sceneDirty = false; sync(); }
  catch (error) { failure(error); }
};
$('remove-scene').onclick = async () => {
  if (!settings || !selectedId) return;
  const scenes = settings.scenes.filter(scene => scene.id !== selectedId);
  try {
    await save({ ...settings, scenes, selectedSceneId: settings.selectedSceneId === selectedId ? scenes[0]?.id ?? null : settings.selectedSceneId,
      away: { ...settings.away, sceneId: settings.away.sceneId === selectedId ? null : settings.away.sceneId } });
    sceneDirty = false; selectedId = scenes[0]?.id ?? null; sync();
  } catch (error) { failure(error); }
};
$('activate-scene').onclick = () => { if (selectedId) void client.selectScene(selectedId).catch(failure); };
$('away-button').onclick = async () => { try { const state = await client.setAway(!client.state?.scene.away); client.state = state; selectedId = state.scene.activeId; sceneDirty = false; fillScene(); sync(); } catch (error) { failure(error); } };
$('obs-form').onsubmit = event => {
  event.preventDefault(); if (!settings) return;
  void save({ ...settings, obs: { enabled: input('obs-enabled').checked, url: input('obs-url').value.trim(), password: input('obs-password').value } }).catch(failure);
};
$('chat-form').onsubmit = event => {
  event.preventDefault(); if (!settings) return;
  void save({ ...settings, laplace: { enabled: input('chat-enabled').checked, url: input('chat-url').value.trim(), token: input('chat-token').value, startLocalBridge: input('chat-local').checked } }).catch(failure);
};
input('startup-enabled').onchange = async () => {
  try { await request('/api/startup', 'PUT', { enabled: input('startup-enabled').checked }); toast('已保存'); }
  catch (error) { input('startup-enabled').checked = client.state?.startup ?? false; failure(error); }
};
$('save-away-scene').onclick = () => { if (settings) void save({ ...settings, away: { ...settings.away, sceneId: $<HTMLSelectElement>('away-scene').value || null } }).catch(failure); };
for (const [id, path] of [['reconnect-obs', '/api/obs/reconnect'], ['reconnect-chat', '/api/chat/reconnect'], ['open-obs', '/api/open/obs'],
  ['open-data', '/api/open/data'], ['open-plugins', '/api/open/plugins']] as const) $(id).onclick = () => void request(path, 'POST').catch(failure);
$('copy-url').onclick = async () => {
  if (!client.state) return; try { await navigator.clipboard.writeText(client.state.outputUrl); toast('地址已复制'); } catch (error) { failure(error); }
};

$('reload-preview').onclick = () => { const frame = $<HTMLIFrameElement>('output-frame'); if (frame.src) frame.src = frame.src; };
function drawPlugins(): void {
  const items = client.state?.plugins ?? [];
  const signature = JSON.stringify(items); if (signature === lastPlugins) return; lastPlugins = signature;
  $('plugin-empty').hidden = items.length > 0;
  $('plugin-list').replaceChildren(...items.map(plugin => {
    const row = document.createElement('div'); row.className = 'card plugin-item';
    const copy = document.createElement('div'); copy.className = 'plugin-copy';
    const title = document.createElement('h2'); title.textContent = plugin.name;
    const detail = document.createElement('p'); detail.textContent = plugin.version + ' · ' + ({ running: '运行中', starting: '启动中', disabled: '已停用', error: '加载失败' }[plugin.state] ?? plugin.state);
    copy.append(title, detail);
    if (plugin.error) { const error = document.createElement('p'); error.className = 'error'; error.textContent = plugin.error; copy.append(error); }
    const controls = document.createElement('div'); controls.className = 'plugin-controls';
    const configure = document.createElement('button'); configure.type = 'button'; configure.className = 'text-button'; configure.textContent = '设置';
    configure.onclick = () => void openPlugin(plugin).catch(failure);
    const toggle = document.createElement('input'); toggle.type = 'checkbox'; toggle.setAttribute('role', 'switch'); toggle.setAttribute('aria-label', '启用 ' + plugin.name); toggle.checked = plugin.enabled;
    toggle.onchange = () => {
      if (!settings) return;
      const enabledPlugins = toggle.checked ? [...settings.enabledPlugins.filter(id => id !== plugin.id), plugin.id] : settings.enabledPlugins.filter(id => id !== plugin.id);
      void save({ ...settings, enabledPlugins }).catch(failure);
    };
    controls.append(configure, toggle); row.append(copy, controls); return row;
  }));
}
async function openPlugin(plugin: PluginInfo): Promise<void> {
  panelPlugin = plugin.id; $('plugin-panel').hidden = false; $('plugin-panel-title').textContent = plugin.name;
  const frame = $<HTMLIFrameElement>('plugin-config-frame');
  frame.hidden = !plugin.settingsPage; $('plugin-json-form').hidden = Boolean(plugin.settingsPage);
  if (plugin.settingsPage) frame.src = '/user/plugins/' + encodeURIComponent(plugin.id) + '/' + plugin.settingsPage + '?streamuiPlugin=' + encodeURIComponent(plugin.id);
  else { frame.removeAttribute('src'); $<HTMLTextAreaElement>('plugin-json').value = JSON.stringify(await client.settings('plugin', plugin.id).read(), null, 2); }
}
$('close-plugin-panel').onclick = () => { $('plugin-panel').hidden = true; $<HTMLIFrameElement>('plugin-config-frame').removeAttribute('src'); };
$('plugin-json-form').onsubmit = async event => {
  event.preventDefault();
  try { await client.settings('plugin', panelPlugin).save(JSON.parse($<HTMLTextAreaElement>('plugin-json').value)); toast('已保存'); }
  catch (error) { failure(error); }
};
$('reload-plugins').onclick = () => void request('/api/plugins/reload', 'POST').then(() => toast('已刷新')).catch(failure);
window.addEventListener('message', event => {
  if (event.source !== $<HTMLIFrameElement>('output-frame').contentWindow || !client.state || event.origin !== new URL(client.state.outputUrl).origin || event.data?.source !== 'streamui-preview') return;
  if (event.data.error) toast(String(event.data.error), true);
});
client.onState(sync); client.on('connection', sync);
for (const kind of ['message', 'gift', 'superchat']) client.on<ChatMessage>('chat.' + kind, () => $('chat-count').textContent = String(Number($('chat-count').textContent) + 1));
client.start();
void loadSettings(true).then(() => { sync(); }).catch(failure);
void request<{ directory: string }>('/api/storage').then(storage => $('data-path').textContent = storage.directory).catch(failure);
window.addEventListener('pagehide', () => client.stop()); window.addEventListener('pageshow', () => client.start());

import './config.css';
import { createClient, request } from './sdk/client.ts';
import type { CoreSettings, SceneSlot, PluginInfo } from './sdk/contracts.ts';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id)! as T;
const input = (id: string) => $<HTMLInputElement>(id);
const select = (id: string) => $<HTMLSelectElement>(id);
const client = createClient();
let settings: CoreSettings | null = null, editingId = '', currentTab = 'preview', dirty = false, optionsSignature = '', pluginSignature = '', panelPlugin = '';
const drafts = new Map<string, SceneSlot>();
let toastTimer: ReturnType<typeof setTimeout> | undefined;

function toast(message: string, error = false): void {
  const box = $('feedback'); box.textContent = message; box.dataset.error = String(error); box.hidden = false;
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => box.hidden = true, error ? 7000 : 2400);
}
const failure = (error: unknown) => toast((error as Error).message, true);
function tab(name: string): void {
  currentTab = name;
  document.querySelectorAll<HTMLButtonElement>('[data-tab]').forEach(button => {
    const active = button.dataset.tab === name;
    button.setAttribute('aria-selected', String(active)); button.tabIndex = active ? 0 : -1;
  });
  $('panel-stage').hidden = name === 'settings'; $('panel-settings').hidden = name !== 'settings';
  if (name === 'preview') preview();
}
document.querySelectorAll<HTMLButtonElement>('[data-tab]').forEach(button => {
  button.onclick = () => tab(button.dataset.tab!);
  button.onkeydown = event => {
    const buttons = [...document.querySelectorAll<HTMLButtonElement>('[data-tab]')];
    let index = buttons.indexOf(button);
    if (event.key === 'ArrowRight') index = (index + 1) % buttons.length;
    else if (event.key === 'ArrowLeft') index = (index + buttons.length - 1) % buttons.length;
    else if (event.key === 'Home') index = 0;
    else if (event.key === 'End') index = buttons.length - 1;
    else return;
    event.preventDefault(); buttons[index].focus(); tab(buttons[index].dataset.tab!);
  };
});
function markDirty(): void { dirty = true; $('save-status').textContent = '有未保存的修改'; }
function editScene(): SceneSlot | undefined { return drafts.get(editingId) ?? client.state?.scenes.find(scene => scene.id === editingId); }
function rememberDraft(): void {
  const scene = editScene(); if (!scene) return;
  drafts.set(editingId, { ...scene, name: input('scene-name').value.trim(), obsScene: input('scene-obs').value.trim(),
    entry: input('scene-entry').value.trim(), width: Number(input('scene-width').value), height: Number(input('scene-height').value),
    transition: input('scene-transition').value.trim(), settingsPage: input('scene-settings-page').value.trim() });
}
function fillEditor(): void {
  const scene = editScene(); $<HTMLFieldSetElement>('scene-editor').disabled = !scene;
  if (!scene) { $('scene-custom-panel').hidden = true; return; }
  input('scene-name').value = scene.name; input('scene-obs').value = scene.obsScene; input('scene-entry').value = scene.entry;
  input('scene-width').value = String(scene.width); input('scene-height').value = String(scene.height);
  input('scene-transition').value = scene.transition; input('scene-settings-page').value = scene.settingsPage;
  $('scene-custom-panel').hidden = !scene.settingsPage;
  const frame = $<HTMLIFrameElement>('scene-config-frame');
  if (scene.settingsPage) {
    const url = new URL('/user/' + scene.settingsPage, location.origin); url.searchParams.set('streamuiScene', scene.id);
    if (frame.src !== url.href) frame.src = url.href;
  } else frame.removeAttribute('src');
}
function sceneOptions(): void {
  const state = client.state; if (!state) return;
  if (!state.scenes.some(scene => scene.id === editingId)) editingId = state.scene.selectedId ?? state.scenes[0]?.id ?? '';
  const signature = JSON.stringify(state.scenes.map(scene => [scene.id, scene.name]));
  if (signature !== optionsSignature) {
    optionsSignature = signature;
    const previousAway = select('away-scene').value;
    for (const id of ['scene-picker', 'scene-edit-id']) select(id).replaceChildren(...state.scenes.map(scene => new Option(scene.name, scene.id)));
    select('away-scene').replaceChildren(new Option('未选择', ''), ...state.scenes.map(scene => new Option(scene.name, scene.id)));
    select('away-scene').value = dirty ? previousAway : state.scene.awaySceneId ?? '';
    select('scene-edit-id').value = editingId; fillEditor();
  }
  select('scene-picker').value = state.scene.selectedId ?? '';
}
function activeScene(): SceneSlot | undefined { return client.state?.scenes.find(scene => scene.id === client.state!.scene.activeId); }
function fitPreview(): void {
  const scene = activeScene(); if (!scene) return;
  const viewport = $('stage-viewport'), frame = $<HTMLIFrameElement>('output-frame');
  viewport.style.aspectRatio = scene.width + '/' + scene.height;
  Object.assign(frame.style, { width: scene.width + 'px', height: scene.height + 'px',
    transform: 'scale(' + Math.min(viewport.clientWidth / scene.width, viewport.clientHeight / scene.height) + ')' });
  $('canvas-size').textContent = scene.width + ' × ' + scene.height;
}
function preview(): void {
  const state = client.state; if (!state || currentTab !== 'preview') return;
  const url = new URL(state.outputUrl); url.searchParams.set('preview', '1');
  const frame = $<HTMLIFrameElement>('output-frame'); if (frame.src !== url.href) frame.src = url.href;
  fitPreview();
}
new ResizeObserver(fitPreview).observe($('stage-viewport'));
$<HTMLIFrameElement>('output-frame').onload = fitPreview;
function setStatus(id: string, value: string, live: boolean): void { $(id).textContent = value; $(id).dataset.live = String(live); }
function sync(): void {
  const state = client.state;
  $('host-dot').dataset.live = String(client.connected); $('host-status').textContent = client.connected ? '已连接' : '正在重新连接';
  $('add-scene').toggleAttribute('disabled', !client.connected);
  $('save-settings').toggleAttribute('disabled', !client.connected || !settings);
  select('scene-picker').disabled = !client.connected || !state?.scenes.length;
  for (const id of ['away-enabled', 'away-settings-enabled']) { input(id).disabled = !client.connected || !state?.scene.awaySceneId; input(id).checked = state?.scene.away ?? false; }
  $('away-status').textContent = !client.connected ? '未连接' : state?.scene.away ? '暂离中' : '已返回';
  if (!state) return;
  input('startup-enabled').checked = state.startup; $('output-url').textContent = state.outputUrl;
  if (settings) { settings.scenes = state.scenes; settings.selectedSceneId = state.scene.selectedId; settings.away.enabled = state.scene.away; }
  const names: Record<string, string> = { connected: '已连接', disabled: '未启用', disconnected: '已停用', connecting: '连接中', reconnecting: '正在重新连接' };
  setStatus('obs-status', client.connected ? names[state.obs.state] ?? state.obs.state : '未连接', client.connected && state.obs.state === 'connected');
  setStatus('chat-status', client.connected ? names[state.chat.state] ?? state.chat.state : '未连接', client.connected && state.chat.state === 'connected');
  $('obs-current').textContent = state.obs.scene ?? '—'; $('chat-count').textContent = String(state.chat.events);
  for (const [id, error] of [['obs-error', state.obs.error], ['chat-error', state.chat.error]] as const) { $(id).hidden = !error; $(id).textContent = error ?? ''; }
  sceneOptions(); preview(); drawPlugins();
}
async function loadSettings(fill = false): Promise<void> {
  settings = await request<CoreSettings>('/api/settings');
  if (fill) {
    input('obs-enabled').checked = settings.obs.enabled; input('obs-url').value = settings.obs.url; input('obs-password').value = settings.obs.password;
    input('chat-enabled').checked = settings.laplace.enabled; input('chat-url').value = settings.laplace.url; input('chat-token').value = settings.laplace.token;
    input('chat-local').checked = settings.laplace.startLocalBridge;
    select('away-scene').value = settings.away.sceneId ?? '';
  }
}
$('settings-form').addEventListener('input', event => {
  const target = event.target as HTMLElement; if (target.hasAttribute('data-immediate')) return;
  if (target.closest('#scene-editor')) rememberDraft(); markDirty();
});
$('settings-form').onsubmit = async event => {
  event.preventDefault(); if (!settings) return;
  const button = $<HTMLButtonElement>('save-settings'); button.disabled = true;
  try {
    const next: CoreSettings = { ...settings,
      obs: { enabled: input('obs-enabled').checked, url: input('obs-url').value.trim(), password: input('obs-password').value },
      laplace: { enabled: input('chat-enabled').checked, url: input('chat-url').value.trim(), token: input('chat-token').value, startLocalBridge: input('chat-local').checked },
      away: { enabled: client.state?.scene.away ?? false, sceneId: select('away-scene').value || null },
      scenes: settings.scenes.map(scene => drafts.get(scene.id) ?? scene),
    };
    client.state = await request('/api/settings', 'PUT', next); drafts.clear(); dirty = false;
    await loadSettings(true); optionsSignature = ''; sync(); fillEditor();
    $('save-status').textContent = '已保存，OBS 已同步'; toast('配置已保存并应用');
  } catch (error) { failure(error); }
  finally { button.disabled = false; }
};
select('scene-picker').onchange = () => void client.selectScene(select('scene-picker').value).catch(failure);
select('scene-edit-id').onchange = () => { editingId = select('scene-edit-id').value; fillEditor(); };
for (const id of ['away-enabled', 'away-settings-enabled']) input(id).onchange = async () => {
  try { client.state = await client.setAway(input(id).checked); sync(); } catch (error) { sync(); failure(error); }
};
$('add-scene').onclick = async () => {
  try { const scene = await request<SceneSlot>('/api/scenes', 'POST', { name: '新场景' }); editingId = scene.id; await loadSettings(); optionsSignature = ''; sync(); select('scene-edit-id').value = editingId; fillEditor(); }
  catch (error) { failure(error); }
};
$('remove-scene').onclick = async () => {
  if (!settings || !editingId) return;
  const scenes = settings.scenes.filter(scene => scene.id !== editingId);
  try {
    client.state = await request('/api/settings', 'PUT', { ...settings, scenes,
      selectedSceneId: settings.selectedSceneId === editingId ? scenes[0]?.id ?? null : settings.selectedSceneId,
      away: { ...settings.away, sceneId: settings.away.sceneId === editingId ? null : settings.away.sceneId } });
    drafts.delete(editingId); editingId = scenes[0]?.id ?? ''; await loadSettings(); optionsSignature = ''; sync(); toast('场景已移除');
  } catch (error) { failure(error); }
};
input('startup-enabled').onchange = async () => {
  try { await request('/api/startup', 'PUT', { enabled: input('startup-enabled').checked }); toast('已保存'); }
  catch (error) { input('startup-enabled').checked = client.state?.startup ?? false; failure(error); }
};
for (const [id, path] of [['reconnect-obs', '/api/obs/reconnect'], ['reconnect-chat', '/api/chat/reconnect'], ['open-obs', '/api/open/obs'], ['open-data', '/api/open/data'], ['open-plugins', '/api/open/plugins']] as const)
  $(id).onclick = () => void request(path, 'POST').catch(failure);
$('copy-url').onclick = async () => { if (!client.state) return; try { await navigator.clipboard.writeText(client.state.outputUrl); toast('地址已复制'); } catch (error) { failure(error); } };
$('reload-preview').onclick = () => { const frame = $<HTMLIFrameElement>('output-frame'); if (frame.src) frame.src = frame.src; };
function drawPlugins(): void {
  const plugins = client.state?.plugins ?? [], signature = JSON.stringify(plugins);
  if (signature === pluginSignature) return; pluginSignature = signature;
  $('plugin-empty').hidden = plugins.length > 0;
  $('plugin-list').replaceChildren(...plugins.map(plugin => {
    const row = document.createElement('div'); row.className = 'plugin-item';
    const copy = document.createElement('div'); copy.className = 'plugin-copy';
    const title = document.createElement('h3'); title.textContent = plugin.name;
    const detail = document.createElement('p'); detail.textContent = plugin.version + ' · ' + ({ running: '运行中', starting: '启动中', disabled: '已停用', error: '加载失败' }[plugin.state] ?? plugin.state); copy.append(title, detail);
    if (plugin.error) { const message = document.createElement('p'); message.className = 'error'; message.textContent = plugin.error; copy.append(message); }
    const controls = document.createElement('div'); controls.className = 'plugin-controls';
    const configure = document.createElement('button'); configure.type = 'button'; configure.className = 'text-button'; configure.textContent = '设置'; configure.onclick = () => void openPlugin(plugin).catch(failure);
    const toggle = document.createElement('input'); toggle.type = 'checkbox'; toggle.setAttribute('role', 'switch'); toggle.setAttribute('aria-label', '启用 ' + plugin.name); toggle.setAttribute('data-immediate', ''); toggle.checked = plugin.enabled;
    toggle.onchange = async () => { if (!settings) return; try {
      const enabledPlugins = toggle.checked ? [...settings.enabledPlugins.filter(id => id !== plugin.id), plugin.id] : settings.enabledPlugins.filter(id => id !== plugin.id);
      await request('/api/settings', 'PUT', { ...settings, enabledPlugins }); await loadSettings(); toast(toggle.checked ? '插件已启用' : '插件已停用');
    } catch (error) { failure(error); } };
    controls.append(configure, toggle); row.append(copy, controls); return row;
  }));
}
async function openPlugin(plugin: PluginInfo): Promise<void> {
  panelPlugin = plugin.id; $('plugin-panel').hidden = false; $('plugin-panel-title').textContent = plugin.name;
  const frame = $<HTMLIFrameElement>('plugin-config-frame'); frame.hidden = !plugin.settingsPage; $('plugin-json-form').hidden = Boolean(plugin.settingsPage);
  if (plugin.settingsPage) frame.src = '/user/plugins/' + encodeURIComponent(plugin.id) + '/' + plugin.settingsPage + '?streamuiPlugin=' + encodeURIComponent(plugin.id);
  else { frame.removeAttribute('src'); $<HTMLTextAreaElement>('plugin-json').value = JSON.stringify(await client.settings('plugin', plugin.id).read(), null, 2); }
}
$('close-plugin-panel').onclick = () => { $('plugin-panel').hidden = true; $<HTMLIFrameElement>('plugin-config-frame').removeAttribute('src'); };
$('plugin-json-form').onsubmit = async event => { event.preventDefault(); try { await client.settings('plugin', panelPlugin).save(JSON.parse($<HTMLTextAreaElement>('plugin-json').value)); toast('已保存'); } catch (error) { failure(error); } };
$('reload-plugins').onclick = () => void request('/api/plugins/reload', 'POST').then(() => toast('已刷新')).catch(failure);
window.addEventListener('message', event => {
  if (event.source !== $<HTMLIFrameElement>('output-frame').contentWindow || !client.state || event.origin !== new URL(client.state.outputUrl).origin || event.data?.source !== 'streamui-preview') return;
  if (event.data.error) toast(String(event.data.error), true);
});
client.onState(sync); client.on('connection', sync);
for (const kind of ['message', 'gift', 'superchat']) client.on('chat.' + kind, () => $('chat-count').textContent = String(Number($('chat-count').textContent) + 1));
client.start(); void loadSettings(true).then(sync).catch(failure);
window.addEventListener('pagehide', () => client.stop()); window.addEventListener('pageshow', () => client.start());

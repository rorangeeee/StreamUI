import './config.css';
import { fillObsSettings, obsSettingsFromForm } from './config-layout.ts';
import { fillAwaySettings, awaySettingsFromForm } from './config-away.ts';
import { api, host } from './host-client.ts';
import type { HostConfig, HostState } from './host-client.ts';
import { HostAudio } from './audio.ts';
import { STAGE_WIDTH, STAGE_HEIGHT, STAGE_LAYOUT_VERSION } from './stage-layout.ts';

interface Device { id: string; name: string; channels: number; sampleRate: number; isDefault: boolean }
const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id)! as T;
const input = (id: string) => $<HTMLInputElement>(id);
const select = (id: string) => $<HTMLSelectElement>(id);
const iframe = $<HTMLIFrameElement>('output-frame');
const audio = new HostAudio();
let settings: HostConfig | null = null;
let devices: Device[] = [];
let currentTab = 'preview';
let feedbackTimer: ReturnType<typeof setTimeout> | null = null;

function feedback(message: string, error = false): void {
  const box = $('feedback');
  box.textContent = message; box.dataset.error = String(error); box.hidden = false;
  if (feedbackTimer) clearTimeout(feedbackTimer);
  feedbackTimer = setTimeout(() => box.hidden = true, error ? 8000 : 3000);
}
function fitFrame(): void {
  const canvas = host.state?.config.canvas ?? { width: STAGE_WIDTH, height: STAGE_HEIGHT };
  const viewport = $('stage-viewport');
  viewport.style.aspectRatio = `${canvas.width} / ${canvas.height}`;
  Object.assign(iframe.style, { width: `${canvas.width}px`, height: `${canvas.height}px`, transform: `scale(${Math.min(viewport.clientWidth / canvas.width, viewport.clientHeight / canvas.height)})` });
  $('canvas-size').textContent = `${canvas.width} × ${canvas.height}`;
}
function loadFrame(): void {
  if (!host.state || currentTab === 'settings') return;
  const url = new URL(host.state.obsUrl);
  if (iframe.src !== url.href) iframe.src = url.href;
  fitFrame();
}
function tab(name: string): void {
  currentTab = name;
  document.querySelectorAll<HTMLButtonElement>('[data-tab]').forEach(button => {
    const active = button.dataset.tab === name;
    button.setAttribute('aria-selected', String(active)); button.tabIndex = active ? 0 : -1;
  });
  $('panel-stage').hidden = name === 'settings';
  $('panel-settings').hidden = name !== 'settings';
  loadFrame();
}
document.querySelectorAll<HTMLButtonElement>('[data-tab]').forEach(button => {
  button.onclick = () => tab(button.dataset.tab!);
  button.onkeydown = event => {
    const buttons = Array.from(document.querySelectorAll<HTMLButtonElement>('[data-tab]'));
    let index = buttons.indexOf(button);
    if (event.key === 'ArrowRight') index = (index + 1) % buttons.length;
    else if (event.key === 'ArrowLeft') index = (index + buttons.length - 1) % buttons.length;
    else if (event.key === 'Home') index = 0;
    else if (event.key === 'End') index = buttons.length - 1;
    else return;
    event.preventDefault(); buttons[index].focus(); tab(buttons[index].dataset.tab!);
  };
});
new ResizeObserver(fitFrame).observe($('stage-viewport'));
iframe.addEventListener('load', fitFrame);

function status(id: string, state: string, live: boolean): void { $(id).textContent = state; $(id).dataset.live = String(live); }
function syncState(): void {
  const state = host.state;
  $('host-dot').dataset.live = String(host.connected);
  $('host-status').textContent = host.connected ? '已连接' : '正在重新连接';
  if (!host.connected) {
    status('audio-status', '未连接', false); status('laplace-status', '未连接', false);
    status('now-playing-status', '未连接', false); $('now-playing-detail').textContent = '未连接';
    return;
  }
  if (!state) return;
  const track = state.nowPlaying;
  status('now-playing-status', track?.playing ? '正在播放' : track?.state === 'paused' ? '已暂停' : '等待曲目', Boolean(track?.playing));
  $('now-playing-detail').textContent = track?.playing ? `${track.title}${track.artist ? ` — ${track.artist}` : ''}`
    : track?.state === 'unavailable' ? '正在读取曲目信息' : '暂无曲目';
  $('obs-url').textContent = state.obsUrl;
  status('audio-status', ({ live: '采集中', idle: '已停止', error: '设备不可用', connecting: '正在连接' })[state.audio.state] ?? '等待连接', state.audio.state === 'live');
  const rate = state.audio.deviceSampleRate && state.audio.deviceSampleRate !== state.audio.sampleRate ? `设备 ${state.audio.deviceSampleRate / 1000} kHz → 可视化 ${state.audio.sampleRate / 1000} kHz` : `${state.audio.sampleRate / 1000} kHz`;
  const fps = state.audio.frameRate > 0 ? ` · ${state.audio.frameRate.toFixed(1)} fps` : '';
  $('audio-detail').textContent = state.audio.error ?? (state.audio.sampleRate ? `${rate} · ${state.audio.channels} 声道${fps}` : '等待音频设备');
  status('laplace-status', ({ connected: '已连接', disconnected: '已停用', connecting: '正在连接', reconnecting: '等待重连' })[state.laplace.state] ?? '等待连接', state.laplace.state === 'connected');
  $('laplace-detail').textContent = state.laplace.error ?? (state.laplace.state === 'connected' ? '等待新消息' : '等待桥接服务');
  $('event-count').textContent = String(state.laplace.events);
  input('startup-enabled').checked = state.startup;
  if (settings) settings.layout = state.config.layout;
  loadFrame();
}
host.addEventListener('state', syncState);
host.addEventListener('connectionchange', syncState);
host.addEventListener('chat', () => { $('event-count').textContent = String(Number($('event-count').textContent) + 1); });

function updateChannels(preferred = Number(select('audio-channel').value)): void {
  const device = select('audio-device').value === 'default' ? devices.find(d => d.isDefault) : devices.find(d => d.id === select('audio-device').value);
  const count = Math.min(32, device?.channels ?? 2);
  select('audio-channel').replaceChildren(new Option('混合全部声道', '-1'), ...Array.from({ length: count }, (_, i) => new Option(`声道 ${i + 1}${i < 2 ? i === 0 ? ' · 左' : ' · 右' : ''}`, String(i))));
  select('audio-channel').value = preferred >= 0 && preferred < count ? String(preferred) : '-1';
}
async function refreshDevices(preferred = select('audio-device').value): Promise<void> {
  const button = $<HTMLButtonElement>('refresh-devices'); button.disabled = true;
  try {
    devices = await api<Device[]>('/api/audio/devices');
    select('audio-device').replaceChildren(new Option('跟随 Windows 默认输出', 'default'), ...devices.map(device => new Option(`${device.name}${device.isDefault ? '（默认）' : ''}`, device.id)));
    if (preferred !== 'default' && !devices.some(device => device.id === preferred)) select('audio-device').add(new Option('已保存的设备（暂不可用）', preferred));
    select('audio-device').value = preferred;
    updateChannels(settings?.audio.channel);
    if (!devices.length) feedback('未发现可用输出设备，连接设备后点击刷新。');
  } finally { button.disabled = false; }
}
function fillForm(config: HostConfig): void {
  fillObsSettings(config.obs);
  fillAwaySettings(config.away);
  input('audio-enabled').checked = config.audio.enabled;
  if (config.audio.deviceId !== 'default') select('audio-device').add(new Option('已保存的输出设备', config.audio.deviceId));
  select('audio-device').value = config.audio.deviceId;
  updateChannels(config.audio.channel);
  input('audio-gain').value = String(config.audio.gain);
  $('gain-value').textContent = `${config.audio.gain.toFixed(2)}×`;
  input('laplace-enabled').checked = config.laplace.enabled;
  input('laplace-url').value = config.laplace.url;
  input('laplace-token').value = config.laplace.token;
  input('laplace-local').checked = config.laplace.startLocalBridge;
  input('canvas-width').value = String(config.canvas.width);
  input('canvas-height').value = String(config.canvas.height);
  $<HTMLTextAreaElement>('title-english-lines').value = (config.titles?.english ?? ['TITLE']).join('\n');
  $<HTMLTextAreaElement>('title-chinese-lines').value = (config.titles?.chinese ?? ['标题']).join('\n');
}
input('audio-gain').oninput = () => $('gain-value').textContent = `${Number(input('audio-gain').value).toFixed(2)}×`;
select('audio-device').onchange = () => updateChannels();
$('refresh-devices').onclick = () => void refreshDevices().catch(error => feedback(String(error.message), true));
$('settings-form').addEventListener('input', event => {
  if (!(event.target as HTMLElement).hasAttribute('data-immediate')) $('save-status').textContent = '有未保存的修改';
});
$('settings-form').addEventListener('submit', async event => {
  event.preventDefault(); if (!settings) return;
  const button = $<HTMLButtonElement>('save-settings'); button.disabled = true;
  const next: HostConfig = {
    audio: { enabled: input('audio-enabled').checked, deviceId: select('audio-device').value, channel: Number(select('audio-channel').value), gain: Number(input('audio-gain').value) },
    laplace: { enabled: input('laplace-enabled').checked, url: input('laplace-url').value.trim(), token: input('laplace-token').value, startLocalBridge: input('laplace-local').checked },
    canvas: { width: Number(input('canvas-width').value), height: Number(input('canvas-height').value) }, layout: settings.layout,
    titles: {
      english: $<HTMLTextAreaElement>('title-english-lines').value.split(/\r?\n/).map(line => line.trim()).filter(Boolean),
      chinese: $<HTMLTextAreaElement>('title-chinese-lines').value.split(/\r?\n/).map(line => line.trim()).filter(Boolean),
    },
    layoutVersion: STAGE_LAYOUT_VERSION,
    layoutMode: host.state?.config.layoutMode ?? '21:9',
    layoutProfiles: host.state?.config.layoutProfiles ?? {},
    obs: obsSettingsFromForm(),
    away: awaySettingsFromForm(),
  };
  try {
    await api<HostState>('/api/settings', 'PUT', next); settings = next;
    $('save-status').textContent = '已保存，OBS 已同步'; feedback('配置已保存并应用');
  } catch (error) { feedback((error as Error).message, true); }
  finally { button.disabled = false; }
});
input('startup-enabled').onchange = async () => {
  const enabled = input('startup-enabled').checked;
  try { await api('/api/startup', 'PUT', { enabled }); feedback(enabled ? '已启用登录后自动启动' : '已关闭登录后自动启动'); }
  catch (error) { input('startup-enabled').checked = !enabled; feedback((error as Error).message, true); }
};
function action(id: string, path: string, message: string): void {
  const button = $<HTMLButtonElement>(id);
  button.onclick = async () => {
    button.disabled = true;
    try { await api(path, 'POST'); feedback(message); }
    catch (error) { feedback((error as Error).message, true); }
    finally { button.disabled = false; }
  };
}
action('restart-audio', '/api/audio/restart', '正在重新连接音频设备');
action('reconnect-laplace', '/api/laplace/reconnect', '正在重新连接 LAPLACE');
action('reconnect-obs', '/api/obs/reconnect', '正在重新连接 OBS（使用已保存的设置）');
action('open-obs', '/api/open/obs', '已打开 OBS 画面');
$('copy-url').onclick = async () => {
  if (!host.state) return;
  try { await navigator.clipboard.writeText(host.state.obsUrl); feedback('OBS 浏览器源地址已复制'); }
  catch { feedback(`OBS 地址：${host.state.obsUrl}`); }
};
function meter(): void {
  const frame = audio.read();
  let peak = 0;
  if (frame) for (const value of frame.waveform) peak = Math.max(peak, Math.abs(value));
  $<HTMLMeterElement>('audio-meter').value = peak;
  $('audio-level').textContent = peak > .00001 ? `${(20 * Math.log10(peak)).toFixed(1)} dB` : '−∞ dB';
  requestAnimationFrame(meter);
}
async function initialize(): Promise<void> {
  $<HTMLButtonElement>('save-settings').disabled = true;
  try {
    settings = await api<HostConfig>('/api/settings'); fillForm(settings);
    await refreshDevices(settings.audio.deviceId);
  } catch (error) { feedback((error as Error).message, true); }
  finally { $<HTMLButtonElement>('save-settings').disabled = settings === null; }
}
host.start(); audio.start(); requestAnimationFrame(meter); void initialize();
window.addEventListener('pagehide', () => { host.stop(); audio.stop(); });
window.addEventListener('pageshow', () => { host.start(); audio.start(); });

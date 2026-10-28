import './config-layout.css';
import { api, host } from './host-client.ts';
import type { ObsSettings, HostState } from './host-client.ts';
import { isStageMode } from './stage-layout.ts';

const field = (id: string) => document.getElementById(id)! as HTMLInputElement;
const picker = document.getElementById('layout-mode')! as HTMLSelectElement;
let switching = false;

export function fillObsSettings(settings?: ObsSettings): void {
  field('obs-websocket-url').value = settings?.url ?? 'ws://127.0.0.1:4455';
  field('obs-websocket-password').value = settings?.password ?? '';
  field('obs-scene-21').value = settings?.scene21 ?? '';
  field('obs-scene-16').value = settings?.scene16 ?? '';
}

export function obsSettingsFromForm(): ObsSettings {
  return { url: field('obs-websocket-url').value.trim(), password: field('obs-websocket-password').value,
    scene21: field('obs-scene-21').value.trim(), scene16: field('obs-scene-16').value.trim() };
}

function sync(): void {
  const state = host.state;
  picker.disabled = !host.connected || switching;
  picker.value = state?.config.layoutMode ?? '21:9';
  const status = document.getElementById('obs-scene-status')!;
  const detail = document.getElementById('obs-scene-detail')!;
  const modeDetail = document.getElementById('layout-mode-detail')!;
  const obs = state?.obs;
  status.textContent = !host.connected ? 'Host 离线' : ({ disabled: '未启用', connecting: '连接中', connected: '已连接', reconnecting: '等待重连' }[obs?.state ?? 'disabled'] ?? '等待连接');
  status.dataset.live = String(host.connected && obs?.state === 'connected');
  const transition = obs?.transition;
  detail.textContent = obs?.error ?? obs?.detail ?? (transition?.phase === 'started'
    ? `正在转场：${transition.name}`
    : obs?.scene ? `当前输出场景：${obs.scene}` : '—');
  modeDetail.textContent = `${picker.value} · 两套布局独立保存`;
}

picker.addEventListener('change', async () => {
  const mode = picker.value;
  if (!isStageMode(mode)) return;
  switching = true; picker.disabled = true;
  try {
    const state = await api<HostState>('/api/layout-mode', 'PUT', { mode });
    host.state = state; host.dispatchEvent(new Event('state'));
    document.getElementById('layout-status')!.textContent = `已切换至 ${mode} · OBS 已同步`;
  } catch (error) {
    document.getElementById('layout-status')!.textContent = (error as Error).message;
  } finally { switching = false; sync(); }
});
host.addEventListener('state', sync);
host.addEventListener('connectionchange', sync);
sync();

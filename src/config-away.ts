import { api, host } from './host-client.ts';
import type { AwaySettings, HostState } from './host-client.ts';
import { AWAY_DEFAULTS } from './away-motion.ts';

const field = (id: string) => document.getElementById(id)! as HTMLInputElement;
const switches = [field('away-enabled'), field('away-settings-enabled')];
let busy = false;
let errorText = '';

export function fillAwaySettings(settings: AwaySettings = AWAY_DEFAULTS): void {
  field('away-text-1').value = settings.text1;
  field('away-text-2').value = settings.text2;
  field('away-opacity').value = String(Math.round(settings.overlayOpacity * 100));
  document.getElementById('away-opacity-value')!.textContent = `${Math.round(settings.overlayOpacity * 100)}%`;
}

export function awaySettingsFromForm(): AwaySettings {
  return { enabled: host.state?.config.away?.enabled ?? false, text1: field('away-text-1').value.trim(),
    text2: field('away-text-2').value.trim(), overlayOpacity: Number(field('away-opacity').value) / 100 };
}

function sync(): void {
  const enabled = host.state?.config.away?.enabled ?? false;
  for (const input of switches) { input.checked = enabled; input.disabled = !host.connected || busy; }
  const status = document.getElementById('away-status')!;
  status.textContent = errorText || (!host.connected ? '等待 Host 连接' : enabled ? '暂离已开启 · 置顶提示与遮罩正在显示' : '暂离已关闭');
  status.dataset.live = String(enabled);
}
for (const input of switches) input.addEventListener('change', async () => {
  const enabled = input.checked;
  errorText = '';
  busy = true; switches.forEach(toggle => toggle.disabled = true);
  try {
    const state = await api<HostState>('/api/away', 'PUT', { enabled });
    host.state = state; host.dispatchEvent(new Event('state'));
  } catch (error) { errorText = (error as Error).message; }
  finally { busy = false; sync(); }
});
field('away-opacity').addEventListener('input', () => {
  document.getElementById('away-opacity-value')!.textContent = `${field('away-opacity').value}%`;
});
host.addEventListener('state', sync);
host.addEventListener('connectionchange', sync);
sync();

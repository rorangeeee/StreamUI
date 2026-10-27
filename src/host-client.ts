import type { SavedLayout } from './layout.ts';
import type { NowPlayingTrack } from './now-playing-data.ts';
import type { StageMode } from './stage-layout.ts';

export interface ObsSettings { url: string; password: string; scene21: string; scene16: string }
export interface AwaySettings { enabled: boolean; text1: string; text2: string; overlayOpacity: number }

export interface HostConfig {
  audio: { enabled: boolean; deviceId: string; channel: number; gain: number };
  laplace: { enabled: boolean; url: string; token: string; startLocalBridge: boolean };
  canvas: { width: number; height: number };
  layout: SavedLayout | null;
  titles: { english: string[]; chinese: string[] };
  layoutVersion: number;
  layoutMode: StageMode;
  layoutProfiles: Partial<Record<StageMode, SavedLayout | null>>;
  obs: ObsSettings;
  away?: AwaySettings;
}
export interface ObsTransition { id: string; name: string; startedAt: number; phase: 'started' | 'ended' | 'video-ended' }
export interface HostState {
  nowPlaying?: NowPlayingTrack;
  obs?: { state: string; scene: string | null; error: string | null; detail?: string | null; transition?: ObsTransition | null };
  config: HostConfig;
  audio: { state: string; error: string | null; deviceId: string | null; sampleRate: number; channels: number; deviceSampleRate: number; frameRate: number };
  laplace: { state: string; error: string | null; localBridge: boolean; events: number; lastEventAt: string | null };
  obsUrl: string;
  configUrl: string;
  startup: boolean;
}

export function socketUrl(path: string): string {
  const url = new URL(path, location.href);
  url.protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  return url.href;
}

export class HostConnection extends EventTarget {
  state: HostState | null = null;
  connected = false;
  private socket: WebSocket | null = null;
  private retry: ReturnType<typeof setTimeout> | null = null;
  private active = false;
  private offline = false;
  setOffline(offline: boolean): void { this.offline = offline; if (offline) this.stop(); }
  start(): void { if (this.offline) return; this.active = true; this.connect(); }
  stop(): void {
    this.active = false;
    if (this.retry) clearTimeout(this.retry);
    this.retry = null;
    const socket = this.socket; this.socket = null; socket?.close();
    this.connected = false;
  }
  private connect(): void {
    if (!this.active || this.socket) return;
    const socket = new WebSocket(socketUrl('/ws/events'));
    this.socket = socket;
    socket.onopen = () => { this.connected = true; this.dispatchEvent(new Event('connectionchange')); };
    socket.onmessage = (event: MessageEvent<string>) => {
      try {
        const message = JSON.parse(event.data);
        if (message.type === 'state') {
          this.state = message.data as HostState;
          this.dispatchEvent(new CustomEvent('state', { detail: this.state }));
        } else if (message.type === 'chat') this.dispatchEvent(new CustomEvent('chat', { detail: message.data }));
      } catch { /* Ignore incomplete or unsupported messages. */ }
    };
    socket.onclose = () => {
      if (this.socket !== socket) return;
      this.socket = null; this.connected = false;
      this.dispatchEvent(new Event('connectionchange'));
      if (this.active) this.retry = setTimeout(() => { this.retry = null; this.connect(); }, 1500);
    };
    socket.onerror = () => socket.close();
  }
}
export const host = new HostConnection();

export async function api<T = void>(path: string, method = 'GET', body?: unknown): Promise<T> {
  const response = await fetch(path, {
    method,
    keepalive: method !== 'GET',
    headers: { 'Content-Type': 'application/json', 'X-StreamUI-Request': '1' },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  if (!response.ok) {
    const data = await response.json().catch(() => null) as { error?: string } | null;
    throw new Error(data?.error ?? `操作失败（HTTP ${response.status}）`);
  }
  return response.headers.get('content-type')?.includes('application/json') ? response.json() as Promise<T> : undefined as T;
}

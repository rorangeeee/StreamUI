import './style.css';
import './stage.css';
import './stage-wide.css';
import './transition.css';
import stageMarkup from '../index.html?raw';
import './stream-marquee.ts';
import './on-air-indicator.ts';
import './barcode-code.ts';
import './data-matrix-code.ts';
import './locator-marker.ts';
import './design-credit.ts';
import './audio-scope.ts';
import './now-playing.ts';
import './chat-terminal.ts';
import './chat-history-terminal.ts';
import { KineticWordmark } from './kinetic-wordmark.ts';
import { MetadataTerminal } from './metadata-terminal.ts';
import { StagePresentation } from './stage-presentation.ts';
import { host } from './host-client.ts';
import type { HostState } from './host-client.ts';
import { isStageMode } from './stage-layout.ts';
import type { StageMode } from './stage-layout.ts';
import { transitionManifest, TRANSITION_DURATION, TRANSITION_FPS, TRANSITION_PHASE_LABELS, TRANSITION_SEED } from './transition-model.ts';
import { TransitionRenderer } from './transition-renderer.ts';
import { transitionLayout, transitionSettings } from './transition-settings.ts';
import type { TransitionSettings } from './transition-settings.ts';

interface TransitionAPI {
  readonly ready: Promise<void>;
  readonly manifest: ReturnType<typeof transitionManifest> & { target: StageMode; seed: number; canvas: { width: number; height: number }; retroPixelLoaded: boolean; settings: TransitionSettings };
  seekFrame(frame: number, fps?: number): void;
  renderFrame(frame: number, fps?: number): Promise<void>;
  setTarget(target: StageMode): Promise<void>;
  setSettings(settings: unknown): Promise<void>;
}
declare global { interface Window { streamuiTransition: TransitionAPI; __STREAMUI_TRANSITION_SETTINGS__?: unknown } }

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id)! as T;
const surface = $('transition-surface'), viewport = $('transition-viewport');
const targetPicker = $<HTMLSelectElement>('transition-target');
const scrub = $<HTMLInputElement>('transition-scrub');
scrub.max = String(transitionManifest().totalFrames);
const params = new URLSearchParams(location.search);
const renderMode = params.get('render') === '1';
document.body.dataset.transitionRender = String(renderMode);
let target: StageMode = isStageMode(params.get('to')) ? params.get('to') as StageMode : '16:9';
const seed = params.has('seed') && Number.isFinite(Number(params.get('seed'))) ? Number(params.get('seed')) >>> 0 : TRANSITION_SEED;
let settings = transitionSettings(window.__STREAMUI_TRANSITION_SETTINGS__);
let retroPixelLoaded = false, currentTime = 0, animation = 0, playStart = 0;

// The arriving layout is a visual snapshot, never another audio/chat collector.
host.setOffline(true);
const parsed = new DOMParser().parseFromString(stageMarkup, 'text/html');
const workspace = document.importNode(parsed.querySelector<HTMLElement>('#workspace')!, true);
workspace.removeAttribute('tabindex');
workspace.querySelectorAll('[tabindex]').forEach(node => node.removeAttribute('tabindex'));
workspace.style.opacity = '0';
surface.append(workspace);
const presentation = new StagePresentation(workspace);
const renderer = new TransitionRenderer(surface, workspace, false, seed);

function fit(): void {
  const { width, height } = settings.canvas;
  viewport.style.aspectRatio = `${width} / ${height}`;
  viewport.style.setProperty('--transition-aspect', String(width / height));
  surface.style.transform = `scale(${Math.min(viewport.clientWidth / width, viewport.clientHeight / height)})`;
}
new ResizeObserver(fit).observe(viewport);

function snapshotState(): HostState {
  return {
    config: { canvas: settings.canvas, titles: settings.titles, layoutMode: target, layout: settings.layoutProfiles[target], layoutProfiles: settings.layoutProfiles,
      layoutVersion: 3, audio: { enabled: false, deviceId: 'default', channel: -1, gain: 1 }, laplace: { enabled: false, url: 'ws://localhost:9696', token: '', startLocalBridge: false },
      obs: { url: 'ws://127.0.0.1:4455', password: '', scene21: '', scene16: '' } },
    audio: { state: 'idle', error: null, deviceId: null, sampleRate: 48000, deviceSampleRate: 48000, channels: 2, frameRate: 60 },
    laplace: { state: 'disconnected', error: null, localBridge: false, events: 0, lastEventAt: null },
    startup: false, obsUrl: '', configUrl: '',
  };
}

async function rebuild(): Promise<void> {
  pause();
  targetPicker.value = target;
  const { width, height } = settings.canvas, uiScale = Math.min(width / 3840, height / 2160);
  Object.assign(surface.style, { width: `${width}px`, height: `${height}px` });
  Object.assign(workspace.style, { width: `${width}px`, height: `${height}px` });
  workspace.style.setProperty('--ui-scale', String(uiScale));
  document.body.dataset.editing = 'false';
  presentation.apply(target);
  const layout = structuredClone(transitionLayout(settings, target));
  if (target === '16:9') Object.assign(layout.windows['stream-window'], { x: 0, y: 0, width: 1, height: 1, angle: 0 });
  const rectangles = Object.fromEntries(Object.entries(layout.windows).map(([id, r]) => [id, { ...r, x: r.x * width, y: r.y * height, width: r.width * width, height: r.height * height }]));
  for (const [id, r] of Object.entries(rectangles)) {
    const panel = workspace.querySelector<HTMLElement>(`#${id}`)!;
    Object.assign(panel.style, { width: `${r.width}px`, height: `${r.height}px`, transform: `translate(${r.x}px, ${r.y}px) rotate(${r.angle}deg)`, zIndex: String(layout.order.indexOf(id) + 1) });
    panel.style.setProperty('--panel-width', `${r.width}px`); panel.style.setProperty('--panel-height', `${r.height}px`);
    panel.dataset.inverted = String(r.inverted);
    panel.querySelectorAll('audio-scope, kinetic-wordmark').forEach(node => node.toggleAttribute('inverted', r.inverted));
  }
  workspace.querySelector<KineticWordmark>('#bilingual-title')!.setTitles(settings.titles.english, settings.titles.chinese);
  workspace.querySelector<MetadataTerminal>('stream-metadata')!.update(snapshotState());
  renderer.configure(settings, target);
  fit(); draw(0);
  const faces = await document.fonts.load('400 190px "StreamUI Retro Pixel"', 'RESCALING').catch(() => []);
  retroPixelLoaded = faces.length > 0;
  $('transition-font-status').textContent = retroPixelLoaded ? 'RETRO PIXEL 已加载' : '缺少 RETRO PIXEL · 正式导出前请安装字体';
  await document.fonts.ready;
  await new Promise(requestAnimationFrame); await new Promise(requestAnimationFrame);
  renderer.configure(settings, target);
  draw(currentTime);
}

function draw(time: number): void {
  currentTime = Math.min(TRANSITION_DURATION, Math.max(0, time));
  const state = renderer.draw(currentTime);
  scrub.value = String(Math.round(currentTime * .06));
  $('transition-phase').textContent = TRANSITION_PHASE_LABELS[state.phase];
  $('transition-time').textContent = `${(currentTime / 1000).toFixed(3)} s / ${(TRANSITION_DURATION / 1000).toFixed(3)} s`;
}
function pause(): void { cancelAnimationFrame(animation); animation = 0; }
function tick(time: number): void {
  draw(time - playStart);
  if (currentTime >= TRANSITION_DURATION) {
    if (!$<HTMLInputElement>('transition-loop').checked) { animation = 0; return; }
    playStart = time + 450;
  }
  animation = requestAnimationFrame(tick);
}
function play(): void { pause(); draw(0); playStart = performance.now(); animation = requestAnimationFrame(tick); }

let ready = rebuild();
window.streamuiTransition = {
  get ready() { return ready; },
  get manifest() { return { ...transitionManifest(), target, seed, canvas: settings.canvas, retroPixelLoaded, settings }; },
  seekFrame(frame, fps = TRANSITION_FPS) { pause(); draw(frame / fps * 1000); },
  async renderFrame(frame, fps = TRANSITION_FPS) { this.seekFrame(frame, fps); await new Promise(requestAnimationFrame); },
  async setTarget(mode) { if (!isStageMode(mode)) throw new Error('无效的目标布局。'); target = mode; ready = rebuild(); await ready; },
  async setSettings(input) { settings = transitionSettings(input); ready = rebuild(); await ready; },
};
$('transition-replay').onclick = () => void ready.then(play);
$('transition-pause').onclick = pause;
scrub.oninput = () => { pause(); draw(Number(scrub.value) / .06); };
document.querySelectorAll<HTMLButtonElement>('.transition-cues [data-frame]').forEach(button => {
  button.onclick = () => { pause(); draw(Number(button.dataset.frame) / .06); };
});
targetPicker.onchange = () => void window.streamuiTransition.setTarget(targetPicker.value as StageMode);
$('transition-load-host').onclick = async () => {
  try {
    const response = await fetch('/api/state', { signal: AbortSignal.timeout(3000) });
    if (!response.ok) throw new Error('请先启动 StreamUI Host。');
    await window.streamuiTransition.setSettings(await response.json());
    $('transition-status').textContent = '已载入当前布局与标题，预览已更新。';
  } catch (error) { $('transition-status').textContent = (error as Error).message; }
};
void ready.catch(error => { $('transition-status').textContent = `初始化失败：${(error as Error).message}`; });

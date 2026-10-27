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
import { stageDividerPaths } from './stage-dividers.ts';
import { sampleTransition, transitionManifest, transitionTiles, TRANSITION_FPS, TRANSITION_HIGHLIGHT, TRANSITION_PHASE_LABELS, TRANSITION_PURPLE, TRANSITION_SEED } from './transition-model.ts';
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

const NS = 'http://www.w3.org/2000/svg';
const element = <K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number> = {}): SVGElementTagNameMap[K] => {
  const node = document.createElementNS(NS, tag);
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, String(value));
  return node;
};
const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id)! as T;
const surface = $('transition-surface'), viewport = $('transition-viewport');
const targetPicker = $<HTMLSelectElement>('transition-target');
const scrub = $<HTMLInputElement>('transition-scrub');
const params = new URLSearchParams(location.search);
const renderMode = params.get('render') === '1';
document.body.dataset.transitionRender = String(renderMode);
let target: StageMode = isStageMode(params.get('to')) ? params.get('to') as StageMode : '16:9';
const seed = params.has('seed') && Number.isFinite(Number(params.get('seed'))) ? Number(params.get('seed')) >>> 0 : TRANSITION_SEED;
let settings = transitionSettings(window.__STREAMUI_TRANSITION_SETTINGS__);
let retroPixelLoaded = false, currentTime = 0, animation = 0, playStart = 0;
let tiles: SVGRectElement[] = [], previousTileCount = 0, components: HTMLElement[] = [];

// The arriving layout is a visual snapshot, never another audio/chat collector.
host.setOffline(true);
const parsed = new DOMParser().parseFromString(stageMarkup, 'text/html');
const workspace = document.importNode(parsed.querySelector<HTMLElement>('#workspace')!, true);
workspace.removeAttribute('tabindex');
workspace.querySelectorAll('[tabindex]').forEach(node => node.removeAttribute('tabindex'));
workspace.style.opacity = '0';
const arrivalBase = element('svg', { class: 'transition-layer transition-arrival-base' });
const defs = element('defs');
const mask = element('mask', { id: 'transition-arrival-mask', x: 0, y: 0, maskUnits: 'userSpaceOnUse', style: 'mask-type:luminance' });
const maskField = element('rect', { fill: '#fff' });
const captureHole = element('rect', { fill: '#fff' });
mask.append(maskField, captureHole); defs.append(mask);
const arrivalBlack = element('rect', { fill: '#000', mask: 'url(#transition-arrival-mask)' });
const captureFlash = element('rect', { fill: '#000' });
arrivalBase.append(defs, arrivalBlack, captureFlash);
const outlines = element('svg', { class: 'transition-layer transition-outlines' });
const outlinePaths = Array.from({ length: 4 }, () => element('path', { pathLength: 1 }));
outlines.append(...outlinePaths);
const cover = element('svg', { class: 'transition-layer transition-cover' });
const coverRect = element('rect'); cover.append(coverRect);
const grid = element('svg', { class: 'transition-layer transition-grid', 'shape-rendering': 'crispEdges', fill: TRANSITION_PURPLE });
const tunnel = element('svg', { class: 'transition-layer transition-tunnel' });
const tunnelRects = Array.from({ length: 8 }, () => element('rect', { 'vector-effect': 'non-scaling-stroke' }));
tunnel.append(...tunnelRects);
const rescaling = element('svg', { class: 'transition-layer transition-text' });
const rescalingText = element('text', { 'text-anchor': 'middle' }); rescalingText.textContent = 'RESCALING'; rescaling.append(rescalingText);
surface.append(arrivalBase, workspace, outlines, cover, grid, tunnel, rescaling);
const presentation = new StagePresentation(workspace);

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

function chatEdges(x: number, y: number, width: number, height: number, angle: number, uiScale: number): string[] {
  const theta = -16 * Math.PI / 180, rotation = angle * Math.PI / 180, perspective = 2200 * uiScale;
  const corners = [[0, 0], [width, 0], [width, height], [0, height]].map(([px, py]) => {
    const dx = px - width / 2, dy = py - height / 2;
    const z = -dx * Math.sin(theta), projection = perspective / (perspective - z);
    const rx = dx * Math.cos(theta) * projection, ry = dy * projection;
    return [x + width / 2 + rx * Math.cos(rotation) - ry * Math.sin(rotation), y + height / 2 + rx * Math.sin(rotation) + ry * Math.cos(rotation)];
  });
  return corners.map((point, index) => `M${point.join(' ')} L${corners[(index + 1) % 4].join(' ')}`);
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
  for (const svg of [arrivalBase, outlines, cover, grid, tunnel, rescaling]) svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
  for (const rect of [maskField, arrivalBlack, coverRect]) { rect.setAttribute('width', String(width)); rect.setAttribute('height', String(height)); }
  for (const [key, value] of Object.entries({ width, height })) mask.setAttribute(key, String(value));
  const stream = rectangles['stream-window'];
  for (const rect of [captureHole, captureFlash]) for (const [key, value] of Object.entries({ x: stream.x, y: stream.y, width: stream.width, height: stream.height,
    transform: `rotate(${stream.angle} ${stream.x + stream.width / 2} ${stream.y + stream.height / 2})` })) rect.setAttribute(key, String(value));
  const paths = target === '21:9' ? Object.values(stageDividerPaths(stream, rectangles['spectrogram-window'], rectangles['waveform-window']))
    : chatEdges(rectangles['chat-window'].x, rectangles['chat-window'].y, rectangles['chat-window'].width, rectangles['chat-window'].height, rectangles['chat-window'].angle, uiScale);
  outlinePaths.forEach((path, index) => path.setAttribute('d', paths[index]));
  outlines.style.strokeWidth = String((target === '21:9' ? 4 : 1.6) * uiScale);
  tunnel.style.strokeWidth = String(4 * uiScale);
  tiles = transitionTiles(width, height, 300, seed).map(tile => element('rect', { ...tile, visibility: 'hidden' }));
  grid.replaceChildren(...tiles); previousTileCount = 0;
  components = ['#wordmark-blur-window', '#wordmark-window', '#chat-window', '#spectrogram-window', '#waveform-window', '#stream-window',
    'stream-marquee[data-band="bottom-secondary"]', 'stream-marquee[data-band="bottom-primary"]'].map(selector => workspace.querySelector<HTMLElement>(selector)!)
    .filter(node => getComputedStyle(node).display !== 'none');
  fit(); draw(0);
  const faces = await document.fonts.load('400 190px "StreamUI Retro Pixel"', 'RESCALING');
  retroPixelLoaded = faces.length > 0;
  $('transition-font-status').textContent = retroPixelLoaded ? 'RETRO PIXEL 已加载' : '缺少 RETRO PIXEL · 正式导出前请安装字体';
  await document.fonts.ready;
  await new Promise(requestAnimationFrame); await new Promise(requestAnimationFrame);
  const context = document.createElement('canvas').getContext('2d')!;
  let size = 190 * uiScale;
  context.font = `400 ${size}px "StreamUI Retro Pixel", monospace`;
  size *= Math.min(1, width * .72 / context.measureText('RESCALING').width);
  context.font = `400 ${size}px "StreamUI Retro Pixel", monospace`;
  const metrics = context.measureText('RESCALING');
  rescalingText.setAttribute('font-size', String(size)); rescalingText.setAttribute('x', String(width / 2));
  rescalingText.setAttribute('y', String(height / 2 + (metrics.actualBoundingBoxAscent - metrics.actualBoundingBoxDescent) / 2));
  draw(currentTime);
}

function draw(time: number): void {
  currentTime = Math.min(6000, Math.max(0, time));
  const state = sampleTransition(currentTime, tiles.length, components.length);
  surface.dataset.phase = state.phase;
  surface.dataset.frame = String(Math.round(state.frame));
  surface.dataset.opaque = String(state.fullyOpaque);
  // Tile visibility is explicit, so hide the whole SVG with display after filling.
  grid.style.display = state.phase === 'fill' ? 'block' : 'none';
  for (let i = Math.min(previousTileCount, state.visibleTiles); i < Math.max(previousTileCount, state.visibleTiles); i++)
    tiles[i].setAttribute('visibility', i < state.visibleTiles ? 'visible' : 'hidden');
  previousTileCount = state.visibleTiles;
  cover.style.visibility = state.cover ? 'visible' : 'hidden';
  if (state.cover) coverRect.setAttribute('fill', state.cover);
  rescaling.style.visibility = state.textVisible ? 'visible' : 'hidden'; rescaling.style.color = state.textColor;
  tunnel.style.visibility = state.tunnelVisible ? 'visible' : 'hidden';
  const { width, height } = settings.canvas;
  tunnelRects.forEach((rect, index) => {
    const w = width * .96 * .76 ** index * state.tunnelScale, h = w * 9 / 16;
    for (const [key, value] of Object.entries({ x: (width - w) / 2, y: (height - h) / 2, width: w, height: h })) rect.setAttribute(key, String(value));
  });
  workspace.style.opacity = arrivalBase.style.opacity = outlines.style.opacity = state.arrivalVisible ? '1' : '0';
  workspace.setAttribute('aria-hidden', String(!state.arrivalVisible));
  captureHole.setAttribute('fill', state.captureRevealed ? '#000' : '#fff');
  captureFlash.setAttribute('fill', state.captureColor); captureFlash.style.visibility = state.captureRevealed ? 'hidden' : 'visible';
  components.forEach((node, index) => node.style.opacity = state.components[index] ? '1' : '0');
  outlinePaths.forEach((path, index) => {
    const p = state.lineProgress[index];
    path.style.visibility = p > 0 ? 'visible' : 'hidden';
    path.setAttribute('stroke-dasharray', p >= 1 ? 'none' : `${p} 1`);
    path.setAttribute('stroke-dashoffset', String(-(1 - p) / 2));
  });
  scrub.value = String(Math.round(currentTime * .06));
  $('transition-phase').textContent = TRANSITION_PHASE_LABELS[state.phase];
  $('transition-time').textContent = `${(currentTime / 1000).toFixed(3)} s / 6.000 s`;
}
function pause(): void { cancelAnimationFrame(animation); animation = 0; }
function tick(time: number): void {
  draw(time - playStart);
  if (currentTime >= 6000) {
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

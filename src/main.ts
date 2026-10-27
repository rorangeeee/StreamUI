import './style.css';
import './stage.css';
import './stage-wide.css';
import { StagePresentation } from './stage-presentation.ts';
import './stream-marquee.ts';
import './on-air-indicator.ts';
import './barcode-code.ts';
import './data-matrix-code.ts';
import './locator-marker.ts';
import './design-credit.ts';
import { MetadataTerminal } from './metadata-terminal.ts';
import { NowPlaying } from './now-playing.ts';
import { DetectionOverlays } from './detection-overlay.ts';
import { HostAudio } from './audio.ts';
import type { AudioFrame, AudioState } from './audio.ts';
import { AudioScope } from './audio-scope.ts';
import './chat-terminal.ts';
import { KineticWordmark } from './kinetic-wordmark.ts';
import { STAGE_WIDTH, STAGE_HEIGHT } from './stage-layout.ts';
import { WindowManager } from './windows.ts';
import { host } from './host-client.ts';

const editor = new URLSearchParams(location.search).get('edit') === '1';
document.body.dataset.editing = String(editor);
const audio = new HostAudio();
const workspace = document.querySelector<HTMLElement>('#workspace')!;
const presentation = new StagePresentation(workspace);
const windows = new WindowManager(workspace, editor);
const nowPlaying = document.querySelector<NowPlaying>('now-playing')!;
new DetectionOverlays(workspace);
const scopes = Array.from(document.querySelectorAll<AudioScope>('audio-scope'));
let animation = 0;
let previousTime = 0;
let previousFrame: AudioFrame | null = null;
let previousState: AudioState | null = null;
let initialized = false;
let previousLayout = '';
let canvasWidth = STAGE_WIDTH, canvasHeight = STAGE_HEIGHT;

function fitCanvas(): void {
  workspace.style.setProperty('--ui-scale', String(Math.min(canvasWidth / STAGE_WIDTH, canvasHeight / STAGE_HEIGHT)));
  Object.assign(workspace.style, {
    width: `${canvasWidth}px`, height: `${canvasHeight}px`,
    transform: `scale(${Math.min(innerWidth / canvasWidth, innerHeight / canvasHeight)})`,
  });
}

host.addEventListener('state', () => {
  const config = host.state!.config;
  const mode = config.layoutMode ?? '21:9';
  const changedMode = windows.mode !== mode;
  presentation.apply(mode);
  windows.setMode(mode);
  const changedSize = canvasWidth !== config.canvas.width || canvasHeight !== config.canvas.height;
  canvasWidth = config.canvas.width; canvasHeight = config.canvas.height;
  fitCanvas();
  document.querySelector<KineticWordmark>('#bilingual-title')!.setTitles(config.titles?.english ?? ['TITLE'], config.titles?.chinese ?? ['标题']);
  document.querySelector<MetadataTerminal>('stream-metadata')!.update(host.state!);
  nowPlaying.update(host.state!.nowPlaying);
  const layout = JSON.stringify([mode, config.canvas, config.layout]);
  if ((!editor && layout !== previousLayout) || !initialized || changedSize || changedMode) windows.restore(config.layout);
  previousLayout = layout;
  initialized = true;
});
host.addEventListener('connectionchange', () => { if (!host.connected) nowPlaying.update(null); });
workspace.addEventListener('layoutchange', (event) => {
  if (editor && host.state && parent !== window) parent.postMessage({ type: 'streamui:layout', mode: windows.mode, layout: (event as CustomEvent).detail }, new URL(host.state.configUrl).origin);
});
window.addEventListener('message', (event) => {
  if (!editor || !host.state || event.source !== parent || event.origin !== new URL(host.state.configUrl).origin) return;
  if (event.data?.type === 'streamui:reset') { windows.reset(); windows.save(); }
});

function draw(time: number): void {
  const frame = audio.read();
  if (frame !== previousFrame) {
    const elapsed = previousTime ? (time - previousTime) / 1000 : 1 / 60;
    previousTime = time; previousFrame = frame;
    if (windows.mode === '21:9') for (const scope of scopes) scope.render(frame, elapsed);
  }
  if (audio.state === 'live' && !document.hidden) animation = requestAnimationFrame(draw);
}
function syncState(): void {
  cancelAnimationFrame(animation); previousTime = 0; previousFrame = null;
  document.body.dataset.audioState = audio.state;
  workspace.setAttribute('aria-busy', String(audio.state === 'requesting'));
  workspace.setAttribute('aria-label', audio.error ?? '音频可视化与弹幕工作区');
  if (audio.state === 'live' && previousState !== 'live') scopes.forEach(scope => scope.clear());
  previousState = audio.state;
  if (audio.state === 'live' && !document.hidden) animation = requestAnimationFrame(draw);
  else for (const scope of scopes) scope.render(null);
}
audio.addEventListener('statechange', syncState);
document.addEventListener('visibilitychange', syncState);
window.addEventListener('resize', fitCanvas);
window.addEventListener('pagehide', () => { audio.stop(); host.stop(); });
window.addEventListener('pageshow', () => { audio.start(); syncState(); });
fitCanvas(); windows.reset(); audio.start(); syncState();

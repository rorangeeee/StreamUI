import './style.css';
import { SystemAudio } from './audio.ts';
import type { AudioState } from './audio.ts';
import { AudioScope } from './audio-scope.ts';
import './chat-terminal.ts';
import './kinetic-wordmark.ts';
import { WindowManager } from './windows.ts';

const audio = new SystemAudio();
const workspace = document.querySelector<HTMLElement>('#workspace')!;
new WindowManager(workspace);
const scopes = Array.from(document.querySelectorAll<AudioScope>('audio-scope'));
let animation = 0;
let previousTime = 0;
let previousState: AudioState | null = null;
let dismissedMenu = false;

function draw(time: number): void {
  const frame = audio.read();
  const elapsed = previousTime ? (time - previousTime) / 1000 : 1 / 60;
  previousTime = time;
  for (const scope of scopes) scope.render(frame, elapsed);
  if (audio.state === 'live' && !document.hidden) animation = requestAnimationFrame(draw);
}

function syncState(): void {
  cancelAnimationFrame(animation);
  previousTime = 0;
  document.body.dataset.audioState = audio.state;
  workspace.setAttribute('aria-busy', String(audio.state === 'requesting'));
  workspace.setAttribute('aria-label', audio.error ?? '音频可视化与弹幕工作区');
  if (audio.state === 'live' && previousState !== 'live') scopes.forEach((scope) => scope.clear());
  previousState = audio.state;
  if (audio.state === 'live' && !document.hidden) animation = requestAnimationFrame(draw);
  else for (const scope of scopes) scope.render(null);
}

audio.addEventListener('statechange', syncState);
workspace.addEventListener('pointerdown', () => {
  dismissedMenu = !document.querySelector<HTMLElement>('#layer-menu')!.hidden;
});
workspace.addEventListener('click', (event) => {
  if (event.target !== workspace || dismissedMenu || audio.state === 'live') return;
  workspace.focus({ preventScroll: true });
  void audio.start();
});
workspace.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') audio.stop();
});
document.addEventListener('visibilitychange', syncState);
window.addEventListener('pagehide', () => audio.stop());
window.addEventListener('pageshow', syncState);
syncState();

export const TRANSITION_PURPLE = '#40009e';
export const TRANSITION_HIGHLIGHT = '#bfff61';
export const TRANSITION_FPS = 60;
export const TRANSITION_DURATION = 6000;
export const TRANSITION_SEED = 526038;

/** All cues use a 60 fps design clock; export can sample it at any frame rate. */
export const TRANSITION_CUES = {
  covered: 60, textSettled: 80, textFade: 90, flash: 120, tunnel: 126,
  tunnelEnd: 228, outlines: 234, components: 270, captureFlash: 318,
  captureReveal: 338, handoff: 350, end: 360,
} as const;

export type TransitionPhase = 'fill' | 'rescaling' | 'flash' | 'tunnel' | 'construct' | 'reveal' | 'complete';
export const TRANSITION_PHASE_LABELS: Record<TransitionPhase, string> = {
  fill: '01 / 随机像素铺满', rescaling: '02 / RESCALING', flash: '03 / 全屏高亮',
  tunnel: '04 / 加速穿越隧道', construct: '05 / 重建下一布局', reveal: '06 / 露出主画面', complete: '转场完成',
};
export interface TransitionTile { x: number; y: number; width: number; height: number }

export function transitionTiles(width: number, height: number, size = 300, seed = TRANSITION_SEED): TransitionTile[] {
  if (![width, height, size].every(value => Number.isFinite(value) && value > 0)) throw new Error('无效的像素网格尺寸。');
  const tiles: TransitionTile[] = [];
  for (let y = 0; y < height; y += size) for (let x = 0; x < width; x += size)
    tiles.push({ x, y, width: Math.min(size, width - x), height: Math.min(size, height - y) });
  let state = seed >>> 0;
  const random = () => {
    state += 0x6D2B79F5;
    let value = state;
    value = Math.imul(value ^ value >>> 15, value | 1);
    value ^= value + Math.imul(value ^ value >>> 7, value | 61);
    return ((value ^ value >>> 14) >>> 0) / 4294967296;
  };
  for (let i = tiles.length - 1; i > 0; i--) {
    const other = Math.floor(random() * (i + 1));
    [tiles[i], tiles[other]] = [tiles[other], tiles[i]];
  }
  return tiles;
}

const clamp = (value: number) => Math.min(1, Math.max(0, value));
const flashOn = (elapsed: number, width: number) => elapsed >= 0 && (elapsed >= width * 4 || Math.floor(elapsed / width) % 2 === 0);

export function transitionComponentVisible(frame: number, index: number): boolean {
  return flashOn(frame - TRANSITION_CUES.components - index * 5, 3);
}

export function sampleTransition(timeMs: number, tileCount: number, componentCount = 8) {
  const frame = Math.max(0, Number.isFinite(timeMs) ? timeMs * .06 + 1e-7 : 0);
  const c = TRANSITION_CUES;
  const phase: TransitionPhase = frame < c.covered ? 'fill' : frame < c.flash ? 'rescaling'
    : frame < c.tunnel ? 'flash' : frame < c.outlines ? 'tunnel'
    : frame < c.captureFlash ? 'construct' : frame < c.handoff ? 'reveal' : 'complete';
  const textMix = clamp((frame - c.textFade) / (c.flash - c.textFade - 6));
  const highlight = [191, 255, 97];
  return {
    frame, phase,
    visibleTiles: Math.min(tileCount, Math.floor(clamp(frame / c.covered) * tileCount)),
    cover: phase === 'rescaling' ? TRANSITION_PURPLE : phase === 'flash' ? TRANSITION_HIGHLIGHT : phase === 'tunnel' ? '#000000' : null,
    textVisible: phase === 'rescaling' && flashOn(frame - c.covered, 5),
    textColor: `rgb(${highlight.map(channel => Math.round(channel * (1 - textMix))).join(', ')})`,
    tunnelVisible: frame >= c.tunnel && frame < c.tunnelEnd,
    tunnelScale: 1 + 11 * clamp((frame - c.tunnel) / (c.tunnelEnd - c.tunnel)) ** 3,
    arrivalVisible: frame >= c.outlines && frame < c.handoff,
    lineProgress: Array.from({ length: 4 }, (_, index) => 1 - (1 - clamp((frame - c.outlines - index * 6) / 18)) ** 3),
    components: Array.from({ length: componentCount }, (_, index) => transitionComponentVisible(frame, index)),
    captureColor: frame >= c.captureFlash && frame < c.captureReveal && flashOn(frame - c.captureFlash, 5) ? TRANSITION_HIGHLIGHT : '#000000',
    captureRevealed: frame >= c.captureReveal,
    fullyOpaque: frame >= c.covered && frame < c.captureReveal,
  };
}

export function transitionManifest(fps = TRANSITION_FPS) {
  if (!Number.isInteger(fps) || fps < 1 || fps > 240) throw new Error('帧率应为 1–240 的整数。');
  return {
    fps, durationMs: TRANSITION_DURATION, totalFrames: Math.ceil(TRANSITION_DURATION / 1000 * fps),
    transitionPointMs: TRANSITION_CUES.covered / .06,
    transitionPointFrame: Math.ceil(TRANSITION_CUES.covered / 60 * fps),
    opaqueUntilMs: TRANSITION_CUES.captureReveal / .06,
    transparentFromMs: TRANSITION_CUES.handoff / .06,
  };
}

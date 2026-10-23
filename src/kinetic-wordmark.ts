import { hexRgb, inverseRgb, mixRgb, sampleWordmark, WORDMARK_CYCLE, WORDMARKS } from './wordmark-motion.ts';

const SVG_NS = 'http://www.w3.org/2000/svg';
const CENTER_X = 500;
const CENTER_Y = 110;
const CAP_HEIGHT = 112;
const REST_WIDTH = 600;
const STRETCH_BLUR_STRENGTH = .125;

interface GlyphLayer {
  group: SVGGElement;
  text: SVGTextElement;
  prefix: string;
  anchorX: number;
}

interface WordLayer {
  group: SVGGElement;
  glyphs: GlyphLayer[];
}

/** Stretch and horizontal blur variants share a clock, palette, and spacing curve. */
export class KineticWordmark extends HTMLElement {
  static observedAttributes = ['inverted'];
  private static playing = new Set<KineticWordmark>();
  private static elapsed = 0;
  private static previousTime = 0;
  private static animation = 0;
  private static filterId = 0;
  private static tick = (time: number): void => {
    if (this.previousTime) this.elapsed = (this.elapsed + Math.min(time - this.previousTime, 100)) % WORDMARK_CYCLE;
    this.previousTime = time;
    for (const wordmark of this.playing) wordmark.render(this.elapsed);
    this.animation = requestAnimationFrame(this.tick);
  };
  private svg!: SVGSVGElement;
  private layers: WordLayer[] = [];
  private blurEffect!: SVGFEGaussianBlurElement;
  private blurOnly = false;
  private filterId = '';
  private base: [number, number, number] = [64, 0, 158];
  private highlight: [number, number, number] = inverseRgb(this.base);
  private ready = false;
  private reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  private syncPlayback = () => {
    const clock = KineticWordmark;
    if (this.ready && this.isConnected && !document.hidden && !this.reducedMotion.matches) clock.playing.add(this);
    else clock.playing.delete(this);
    if (this.ready && this.isConnected) this.render(this.reducedMotion.matches ? 0 : clock.elapsed);
    if (!clock.playing.size) {
      cancelAnimationFrame(clock.animation);
      clock.animation = 0;
      clock.previousTime = 0;
    } else if (!clock.animation) clock.animation = requestAnimationFrame(clock.tick);
  };

  connectedCallback(): void {
    if (!this.svg) this.build();
    document.addEventListener('visibilitychange', this.syncPlayback);
    this.reducedMotion.addEventListener('change', this.syncPlayback);
    this.readPalette();
    if (this.ready) this.syncPlayback();
    else void this.loadFonts();
  }

  disconnectedCallback(): void {
    this.syncPlayback();
    document.removeEventListener('visibilitychange', this.syncPlayback);
    this.reducedMotion.removeEventListener('change', this.syncPlayback);
  }

  attributeChangedCallback(): void {
    if (!this.svg) return;
    this.readPalette();
    if (this.ready) this.render(this.reducedMotion.matches ? 0 : KineticWordmark.elapsed);
  }

  private build(): void {
    this.svg = document.createElementNS(SVG_NS, 'svg');
    this.svg.setAttribute('viewBox', '0 40 1000 140');
    this.svg.setAttribute('role', 'img');
    this.svg.setAttribute('aria-label', `${WORDMARKS.join('、')} 循环文字动效`);
    this.blurOnly = this.getAttribute('effect') === 'blur';
    const defs = document.createElementNS(SVG_NS, 'defs');
    const filter = document.createElementNS(SVG_NS, 'filter');
    this.filterId = `wordmark-blur-${KineticWordmark.filterId++}`;
    filter.id = this.filterId;
    filter.setAttribute('filterUnits', 'userSpaceOnUse');
    filter.setAttribute('x', '-500');
    filter.setAttribute('y', '0');
    filter.setAttribute('width', '2000');
    filter.setAttribute('height', '220');
    filter.setAttribute('color-interpolation-filters', 'sRGB');
    this.blurEffect = document.createElementNS(SVG_NS, 'feGaussianBlur');
    this.blurEffect.setAttribute('stdDeviation', '0 0');
    filter.append(this.blurEffect);
    defs.append(filter);
    this.svg.append(defs);
    this.layers = WORDMARKS.map((word) => {
      const group = document.createElementNS(SVG_NS, 'g');
      group.classList.add('wordmark-phrase');
      group.setAttribute('fill', 'currentColor');
      group.setAttribute('visibility', 'hidden');
      const glyphs: GlyphLayer[] = [];
      let prefix = '';
      for (const character of word) {
        if (character !== ' ') {
          const glyphGroup = document.createElementNS(SVG_NS, 'g');
          glyphGroup.classList.add('wordmark-glyph');
          const text = document.createElementNS(SVG_NS, 'text');
          text.textContent = character;
          glyphGroup.append(text);
          group.append(glyphGroup);
          glyphs.push({ group: glyphGroup, text, prefix, anchorX: 0 });
        }
        prefix += character;
      }
      this.svg.append(group);
      return { group, glyphs };
    });
    this.replaceChildren(this.svg);
  }

  private async loadFonts(): Promise<void> {
    try {
      await document.fonts.load('400 160px "StreamUI Retro Pixel"', WORDMARKS.join(' '));
      if (!this.isConnected) return;
      const context = document.createElement('canvas').getContext('2d')!;
      context.font = '400 160px "StreamUI Retro Pixel"';
      const measurements = WORDMARKS.map((word) => {
        const metrics = context.measureText(word);
        return { metrics, width: metrics.actualBoundingBoxLeft + metrics.actualBoundingBoxRight, height: metrics.actualBoundingBoxAscent + metrics.actualBoundingBoxDescent };
      });
      const capHeight = Math.min(CAP_HEIGHT, REST_WIDTH / Math.max(...measurements.map((item) => item.width / item.height)));
      this.layers.forEach((layer, index) => {
        const { metrics, height } = measurements[index];
        const scale = capHeight / height;
        const x = CENTER_X + (metrics.actualBoundingBoxLeft - metrics.actualBoundingBoxRight) * scale / 2;
        const y = CENTER_Y + (metrics.actualBoundingBoxAscent - metrics.actualBoundingBoxDescent) * scale / 2;
        context.font = `400 ${160 * scale}px "StreamUI Retro Pixel"`;
        for (const glyph of layer.glyphs) {
          const glyphX = x + context.measureText(glyph.prefix).width;
          const glyphMetrics = context.measureText(glyph.text.textContent!);
          glyph.anchorX = glyphX + (glyphMetrics.actualBoundingBoxRight - glyphMetrics.actualBoundingBoxLeft) / 2;
          glyph.text.setAttribute('font-size', String(160 * scale));
          glyph.text.setAttribute('x', String(glyphX));
          glyph.text.setAttribute('y', String(y));
        }
      });
      this.ready = true;
      this.dataset.fonts = 'ready';
      this.syncPlayback();
    } catch (error) {
      this.dataset.fonts = 'error';
      console.error('[StreamUI wordmark] 无法载入本机 Retro Pixel 字体。', error);
    }
  }

  private readPalette(): void {
    this.base = hexRgb(getComputedStyle(this).getPropertyValue('--accent').trim());
    if (this.hasAttribute('inverted')) this.base = inverseRgb(this.base);
    this.highlight = inverseRgb(this.base);
  }

  private render(time: number): void {
    const state = sampleWordmark(time);
    const index = state.phase === 'shrink' ? state.to : state.from;
    const active = this.layers[index];
    this.dataset.phase = state.phase;
    this.dataset.word = WORDMARKS[index];
    this.svg.style.color = mixRgb(this.base, this.highlight, state.light);
    for (const layer of this.layers) layer.group.setAttribute('visibility', 'hidden');
    active.group.setAttribute('visibility', 'visible');
    const blurX = state.blurX * (this.blurOnly ? 1 : STRETCH_BLUR_STRENGTH);
    this.blurEffect.setAttribute('stdDeviation', `${blurX} 0`);
    active.group.setAttribute('filter', blurX > 0 ? `url(#${this.filterId})` : 'none');
    const scaleX = this.blurOnly ? 1 : state.glyphScaleX;
    for (const glyph of active.glyphs) {
      const anchorX = CENTER_X + (glyph.anchorX - CENTER_X) * state.spacingScale;
      glyph.group.setAttribute('transform', `translate(${anchorX} 0) scale(${scaleX} 1) translate(${-glyph.anchorX} 0)`);
    }
  }
}

customElements.define('kinetic-wordmark', KineticWordmark);

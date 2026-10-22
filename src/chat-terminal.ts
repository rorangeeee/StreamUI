import { LaplaceEventBridgeClient } from '@laplace.live/event-bridge-sdk';
import { ChatEventFormatter } from './chat-events.ts';
import type { ChatEntry } from './chat-events.ts';

const timeFormat = new Intl.DateTimeFormat('zh-CN', {
  hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
});
const LINE_INTERVAL = 160;
const CHARACTER_INTERVAL = 10;
const MAX_TYPING_DURATION = 1200;
const HISTORY_LIMIT = 200;
const graphemeSegmenter = new Intl.Segmenter('zh-CN', { granularity: 'grapheme' });

/** A text-only terminal: each event prints atomically, in three successive lines. */
export class ChatTerminal extends HTMLElement {
  private bridge: LaplaceEventBridgeClient | null = null;
  private formatter = new ChatEventFormatter();
  private viewport!: HTMLDivElement;
  private output!: HTMLDivElement;
  private cursor!: HTMLSpanElement;
  private queue: ChatEntry[] = [];
  private seen = new Set<string>();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private printing = false;
  private unsubscribe: (() => void)[] = [];
  private hide = () => this.disconnectBridge();
  private show = () => this.connectBridge();

  connectedCallback(): void {
    if (!this.viewport) {
      this.viewport = document.createElement('div');
      this.viewport.className = 'terminal-viewport';
      this.output = document.createElement('div');
      this.output.className = 'terminal-output';
      this.output.setAttribute('role', 'log');
      this.output.setAttribute('aria-live', 'polite');
      this.output.setAttribute('aria-label', '直播弹幕');
      this.cursor = document.createElement('span');
      this.cursor.className = 'terminal-cursor';
      this.cursor.setAttribute('aria-hidden', 'true');
      this.output.append(this.cursor);
      this.viewport.append(this.output);
      this.replaceChildren(this.viewport);
    }
    window.addEventListener('pagehide', this.hide);
    window.addEventListener('pageshow', this.show);
    this.connectBridge();
  }

  disconnectedCallback(): void {
    window.removeEventListener('pagehide', this.hide);
    window.removeEventListener('pageshow', this.show);
    this.disconnectBridge();
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
    this.printing = false;
    this.queue = [];
  }

  private connectBridge(): void {
    if (this.bridge) return;
    this.bridge = new LaplaceEventBridgeClient({ url: 'ws://localhost:9696' });
    this.unsubscribe = [
      this.bridge.onAny((event) => this.receive(event)),
      this.bridge.onConnectionStateChange((state) => {
        this.dataset.connection = state;
        this.setAttribute('aria-label', state === 'connected' ? '弹幕终端，已连接' : '弹幕终端，等待连接');
      }),
    ];
    // The SDK keeps reconnecting if the bridge starts after this page.
    void this.bridge.connect().catch(() => {});
  }

  private disconnectBridge(): void {
    this.unsubscribe.forEach((off) => off());
    this.unsubscribe = [];
    this.bridge?.disconnect();
    this.bridge = null;
  }

  private receive(event: unknown): void {
    const entry = this.formatter.format(event);
    if (!entry || (entry.key && this.seen.has(entry.key))) return;
    if (entry.key) {
      this.seen.add(entry.key);
      if (this.seen.size > 2000) this.seen.delete(this.seen.values().next().value!);
    }
    this.queue.push(entry);
    this.printNext();
  }

  private printNext(): void {
    if (this.printing || !this.isConnected) return;
    const entry = this.queue.shift();
    if (!entry) return;
    this.printing = true;
    const article = document.createElement('article');
    article.className = 'terminal-entry';
    article.dataset.kind = entry.kind;
    article.setAttribute('aria-atomic', 'true');
    article.setAttribute('aria-busy', 'true');
    if (entry.key) article.dataset.eventId = entry.key;

    const lines = [
      `[${timeFormat.format(entry.timestamp)}]`,
      `${entry.username} · ${entry.level}`,
      entry.body,
    ];
    const classes = ['terminal-time', 'terminal-user', 'terminal-body'];
    let index = 0;
    const printLine = () => {
      const followTail = this.viewport.scrollHeight - this.viewport.clientHeight - this.viewport.scrollTop < 32;
      if (index === 0) this.output.append(article);
      const line = document.createElement(index === 0 ? 'time' : 'div');
      line.className = `terminal-line ${classes[index]}`;
      if (line instanceof HTMLTimeElement) line.dateTime = new Date(entry.timestamp).toISOString();
      // All upstream text stays text; usernames and messages cannot inject markup.
      const content = document.createTextNode(index === 2 ? '' : lines[index]);
      line.append(content, this.cursor);
      article.append(line);
      while (this.output.childElementCount > HISTORY_LIMIT) {
        const oldest = this.output.firstElementChild!;
        const height = oldest.getBoundingClientRect().height;
        oldest.remove();
        if (!followTail) this.viewport.scrollTop -= height;
      }
      if (followTail) this.viewport.scrollTop = this.viewport.scrollHeight;
      if (index === 2) {
        article.dataset.typing = 'true';
        this.typeBody(content, entry.body, () => {
          delete article.dataset.typing;
          article.setAttribute('aria-busy', 'false');
          this.printing = false;
          this.printNext();
        });
        return;
      }
      index++;
      this.timer = setTimeout(() => {
        this.timer = null;
        printLine();
      }, this.lineInterval());
    };
    printLine();
  }

  private lineInterval(): number {
    return Math.max(32, LINE_INTERVAL / (1 + Math.floor(this.queue.length / 6)));
  }

  private typeBody(content: Text, body: string, done: () => void): void {
    // A grapheme keeps emoji, combining accents and ZWJ sequences intact.
    const characters = Array.from(graphemeSegmenter.segment(body), (part) => part.segment);
    const interval = Math.min(CHARACTER_INTERVAL, MAX_TYPING_DURATION / characters.length);
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const started = performance.now();
    let printed = 0;
    const type = () => {
      const speed = 1 + Math.floor(this.queue.length / 6);
      const next = reducedMotion ? characters.length : Math.min(characters.length, Math.max(1, Math.floor((performance.now() - started) * speed / interval)));
      const followTail = this.viewport.scrollHeight - this.viewport.clientHeight - this.viewport.scrollTop < 32;
      content.appendData(characters.slice(printed, next).join(''));
      printed = next;
      if (followTail) this.viewport.scrollTop = this.viewport.scrollHeight;
      this.timer = setTimeout(() => {
        this.timer = null;
        if (printed < characters.length) type();
        else done();
      }, printed < characters.length ? 16 : this.lineInterval());
    };
    type();
  }
}

customElements.define('chat-terminal', ChatTerminal);

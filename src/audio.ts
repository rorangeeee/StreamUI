export type AudioState = 'idle' | 'requesting' | 'live' | 'error' | 'unsupported';

export interface AudioFrame {
  frequency: Float32Array<ArrayBuffer>;
  waveform: Float32Array<ArrayBuffer>;
  sampleRate: number;
}

/** Captures locally. The graph is never connected to the speakers. */
export class SystemAudio extends EventTarget {
  state: AudioState = 'idle';
  error: string | null = null;
  private stream: MediaStream | null = null;
  private context: AudioContext | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private analyser: AnalyserNode | null = null;
  private frame: AudioFrame | null = null;
  private operation = 0;

  constructor() {
    super();
    if (!navigator.mediaDevices?.getDisplayMedia || !window.AudioContext) {
      this.state = 'unsupported';
      this.error = '当前浏览器不支持系统音频共享，请使用桌面版 Chrome 或 Edge。';
    }
  }

  async start(): Promise<void> {
    if (this.state === 'requesting' || this.state === 'live' || this.state === 'unsupported') return;
    const operation = ++this.operation;
    this.error = null;
    this.setState('requesting');

    try {
      const options: DisplayMediaStreamOptions & { systemAudio: string; selfBrowserSurface: string; surfaceSwitching: string } = {
        video: { displaySurface: 'monitor', frameRate: 1 },
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
        systemAudio: 'include',
        selfBrowserSurface: 'exclude',
        surfaceSwitching: 'exclude',
      };
      const stream = await navigator.mediaDevices.getDisplayMedia(options);
      if (operation !== this.operation) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }

      this.stream = stream;
      const audioTracks = stream.getAudioTracks().filter((track) => track.readyState === 'live');
      if (!audioTracks.length) throw new Error('未共享音频，请重新选择整个屏幕并启用系统音频共享。');

      stream.getTracks().forEach((track) => track.addEventListener('ended', () => {
        if (this.stream === stream) this.stop();
      }, { once: true }));

      const context = new AudioContext({ latencyHint: 'interactive' });
      this.context = context;
      this.source = context.createMediaStreamSource(new MediaStream(audioTracks));
      this.analyser = context.createAnalyser();
      this.analyser.fftSize = 8192;
      this.analyser.smoothingTimeConstant = 0.72;
      this.analyser.minDecibels = -95;
      this.analyser.maxDecibels = -18;
      this.source.connect(this.analyser);
      this.frame = {
        frequency: new Float32Array(this.analyser.frequencyBinCount),
        waveform: new Float32Array(this.analyser.fftSize),
        sampleRate: context.sampleRate,
      };
      await context.resume();
      if (operation !== this.operation) return;
      // A track can end while the audio context is resuming.
      if (audioTracks.some((track) => track.readyState === 'ended')) {
        this.stop();
        return;
      }
      this.setState('live');
    } catch (error) {
      if (operation !== this.operation) return;
      this.release();
      if (error instanceof DOMException && (error.name === 'NotAllowedError' || error.name === 'AbortError')) {
        this.setState('idle');
      } else {
        this.error = error instanceof Error ? error.message : '系统音频捕获失败。';
        console.warn('[StreamUI audio]', this.error);
        this.setState('error');
      }
    }
  }

  read(): AudioFrame | null {
    if (this.state !== 'live' || !this.analyser || !this.frame) return null;
    this.analyser.getFloatFrequencyData(this.frame.frequency);
    this.analyser.getFloatTimeDomainData(this.frame.waveform);
    return this.frame;
  }

  stop(): void {
    ++this.operation;
    this.release();
    this.error = null;
    this.setState('idle');
  }

  private release(): void {
    this.source?.disconnect();
    this.analyser?.disconnect();
    this.stream?.getTracks().forEach((track) => track.stop());
    if (this.context && this.context.state !== 'closed') void this.context.close().catch(() => {});
    this.source = null;
    this.analyser = null;
    this.context = null;
    this.stream = null;
    this.frame = null;
  }

  private setState(state: AudioState): void {
    this.state = state;
    this.dispatchEvent(new Event('statechange'));
  }
}

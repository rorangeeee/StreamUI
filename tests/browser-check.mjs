// Open /tests/browser-check.html with the dev server and a local host/fixture.
// This page is excluded from the production build and never sends real chat events.
import { GLOW_RISE, GLOW_HOLD, GLOW_BLINK_START, GLOW_BLINK_OFF, GLOW_BLINK_ON, GLOW_DURATION } from '../src/marquee-motion.ts';
import { BarcodeMotion, BARCODE_STEP, BARCODE_HOLD, BARCODE_FLASH } from '../src/barcode-motion.ts';
import { BARCODE_BARS } from '../src/barcode-data.ts';
import { nowPlayingLit } from '../src/now-playing-data.ts';
const iframe = document.querySelector('#preview');
const output = document.querySelector('#results');
const doc = () => iframe.contentDocument;
const terminal = () => doc().querySelector('chat-terminal');
let sequence = 0;
const event = (type, values = {}) => ({ type, id: `browser-check-${++sequence}`, origin: 'local-browser-check', username: '测试用户', message: '这一条普通弹幕', giftName: '小花花', timestamp: new Date(2026, 9, 26, 2, 3, 4).getTime(), ...values });
const assert = (value, name) => { if (!value) throw new Error(name); };
const close = (a, b, tolerance = .02) => Math.abs(a - b) < tolerance;
const trackFixture = { title: '夜行 LATENITE', artist: 'When 歌手', playing: true, state: 'playing' };
document.querySelector('#preview-only').onclick = () => { document.body.dataset.preview = 'true'; };
document.querySelector('#size').onchange = event => {
  const [width, height] = event.target.value.split(',');
  iframe.style.width = `${width}px`; iframe.style.height = `${height}px`;
};

function trackPreview(lit) {
  const canvas = doc().querySelector('#spectrogram-window canvas'), context = canvas.getContext('2d');
  context.save(); context.setTransform(1, 0, 0, 1, 0, 0);
  context.fillStyle = '#000'; context.fillRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = '#40009e'; context.fillRect(0, 0, canvas.width / 2, canvas.height); context.restore();
  const track = doc().querySelector('now-playing'); track.update(trackFixture); track.pause(); track.show(lit);
}
document.querySelector('#track-on').onclick = () => trackPreview(true);
document.querySelector('#track-off').onclick = () => trackPreview(false);

function gift(time) {
  const chat = terminal(); chat.pause(); chat.playback.clear(); chat.receive(event('gift')); chat.pause();
  chat.playback.advance(time); chat.render();
}
function glow(time) {
  for (const belt of doc().querySelectorAll('stream-marquee')) {
    belt.glow.forEach(animation => animation.cancel()); belt.glow = [];
    belt.startGlow();
    belt.glow.forEach(animation => { animation.pause(); animation.currentTime = time; });
  }
}
async function rest() {
  const KineticWordmark = doc().querySelector('kinetic-wordmark').constructor;
  for (const wordmark of doc().querySelectorAll('kinetic-wordmark')) {
    KineticWordmark.playing.delete(wordmark); wordmark.render(0);
  }
  for (const belt of doc().querySelectorAll('stream-marquee')) {
    belt.pauseGlowTimer(); belt.glow.forEach(animation => animation.cancel()); belt.glow = []; belt.dataset.glow = 'idle';
  }
  const chat = terminal(); chat.pause(); chat.playback.clear(); chat.receive(event('message')); chat.pause();
  chat.playback.advance(2000); chat.render();
  const track = doc().querySelector('now-playing'); track.update(trackFixture); track.pause(); track.show(true);
}

document.querySelector('#half-gift').onclick = () => { gift(225); output.textContent = '礼物背景 50%，文字尚未出现'; };
document.querySelector('#full-gift').onclick = () => { gift(2000); output.textContent = '礼物背景完成，两行黑色文字'; };
document.querySelector('#glow').onclick = () => { glow(GLOW_RISE + GLOW_HOLD / 2); output.textContent = '文字与光晕均为反色荧光绿'; };
document.querySelector('#rest').onclick = () => rest().then(() => { output.textContent = '静态布局，单条普通弹幕，跑马灯常态紫色'; });

document.querySelector('#run').onclick = async () => {
  const checks = [];
  const check = (value, name, detail = '') => { assert(value, detail ? `${name}: ${detail}` : name); checks.push(`PASS ${name}`); };
  try {
    await doc().fonts.ready;
    const window = iframe.contentWindow;
    const style = element => window.getComputedStyle(element);
    const rect = selector => doc().querySelector(selector).getBoundingClientRect();
    const stage = rect('#workspace');
    check(close(rect('#stream-window').width, stage.width), '主画面占满画布宽度');
    check(close(rect('#stream-window').top, rect('#wordmark-blur-window').bottom), '顶部栏与主画面对齐');
    check(close(rect('#spectrogram-window').right, rect('#waveform-window').left), '底部两块音频区域相接');
    check(doc().querySelector('#waveform-window').dataset.inverted === 'true', '示波器默认反色');
    const metadata = doc().querySelector('stream-metadata');
    const brand = doc().querySelector('.brand-wordmark');
    check(metadata.parentElement === brand.parentElement && +style(metadata).zIndex < +style(brand).zIndex, '信息终端位于品牌文字下层');
    check(rect('stream-metadata').right <= rect('.brand-window').right && rect('stream-metadata').left > rect('.brand-window').left, '信息终端位于品牌区右侧且不溢出');
    check([...doc().querySelectorAll('.scope-window')].every(panel => ['Top', 'Right', 'Bottom', 'Left'].every(side => +style(panel)[`border${side}Width`].replace('px', '') === 0))
      && !doc().querySelector('.pane-outline'), '全部区域均已去除独立外框');
    check(!doc().querySelector('.scope-window .region-divider') && !doc().querySelector('.scope-window .stage-dividers'), '所有区域内部均不再绘制框边');
    const dividers = doc().querySelector('.stage-dividers');
    check(dividers.querySelectorAll('path').length === 4
      && [...dividers.querySelectorAll('path')].every(path => !/z/i.test(path.getAttribute('d'))), '独立图层仅绘制四组开放分割线');
    check(close(rect('#main-top-divider').top, rect('#stream-window').top)
      && close(rect('#main-bottom-divider').top, rect('#stream-window').bottom)
      && close(rect('#main-top-divider').width, rect('#stream-window').width), '主画面上下分割线与实际布局对齐');
    check(close(rect('#audio-split-divider').left, rect('#waveform-window').left)
      && close(rect('#audio-bottom-divider').top, rect('#waveform-window').bottom)
      && close(rect('#audio-bottom-divider').width, rect('#spectrogram-window').width + rect('#waveform-window').width), '两音频区域之间与底部的分割线连续对齐');
    check(style(dividers).stroke === 'rgb(64, 0, 158)'
      && close(parseFloat(style(dividers).strokeWidth), 4 * parseFloat(style(doc().querySelector('#workspace')).getPropertyValue('--ui-scale'))), '分割线统一紫色与线宽，不受示波器反色影响');
    check(style(doc().documentElement).getPropertyValue('--accent').trim() === '#40009e'
      && style(doc().documentElement).getPropertyValue('--accent-inverse').trim() === '#bfff61', '全局主题使用 TOYO82 紫与严格反色');

    const trackLabel = doc().querySelector('now-playing');
    for (let frame = 0; frame < 60 && !trackLabel.ready; frame++) await new Promise(resolve => window.requestAnimationFrame(resolve));
    trackLabel.update(trackFixture); trackLabel.pause(); trackLabel.show(true);
    check(trackLabel.querySelector('.now-playing-content').textContent === 'NOW PLAYING:  夜行 LATENITE-When 歌手', '自动曲目按指定格式显示完整中英文名称');
    const enHeight = trackLabel.querySelector('[data-reference="en"]').getBBox().height;
    const zhHeight = trackLabel.querySelector('[data-reference="zh"]').getBBox().height;
    const desiredHeight = parseFloat(style(trackLabel).height) / 218.615 * 42;
    // SVG font metrics quantize fractional sizes to a subpixel grid.
    check(close(enHeight, zhHeight, .3) && close(enHeight, desiredHeight, .6), '两种字体的实际字高相等且约为 42 px');
    check(+trackLabel.querySelector('[data-reference="zh"]').getAttribute('font-size') < +trackLabel.querySelector('[data-reference="en"]').getAttribute('font-size'), '中文额外缩小字号以匹配英文像素字体');
    const trackBounds = trackLabel.querySelector('.now-playing-content').getBoundingClientRect(), spectrumBounds = rect('#spectrogram-window');
    check(close(trackBounds.left + trackBounds.width / 2, spectrumBounds.left + spectrumBounds.width / 2, .2)
      && close(trackBounds.top + trackBounds.height / 2, spectrumBounds.top + spectrumBounds.height / 2, .2), '曲目文字在频谱图中水平与垂直居中', JSON.stringify({track: [trackBounds.left, trackBounds.top, trackBounds.width, trackBounds.height], panel: [spectrumBounds.left, spectrumBounds.top, spectrumBounds.width, spectrumBounds.height]}));
    check(style(trackLabel).color === 'rgb(64, 0, 158)' && style(trackLabel).mixBlendMode === 'difference'
      && style(doc().querySelector('#spectrogram-window')).isolation === 'isolate', '紫色差值混合只作用于频谱图');
    trackLabel.show(nowPlayingLit(800));
    check(style(trackLabel).visibility === 'hidden' && style(trackLabel).transitionDuration === '0s', '灭相位直接隐藏文字，不使用淡出');
    trackLabel.update({ ...trackFixture, playing: false, state: 'paused' });
    check(style(trackLabel).visibility === 'hidden' && !trackLabel.querySelector('.now-playing-content').textContent, '播放器暂停或无曲目时隐藏整段显示');
    trackLabel.update({ ...trackFixture, title: '特别长的歌曲名称'.repeat(80) }); trackLabel.pause(); trackLabel.show(true);
    const longTrackBounds = trackLabel.querySelector('.now-playing-content').getBoundingClientRect();
    check(longTrackBounds.left >= spectrumBounds.left && longTrackBounds.right <= spectrumBounds.right, '超长曲名等比适配频谱宽度');
    trackLabel.update(trackFixture); trackLabel.pause(); trackLabel.show(true);
    const restoredTrackBounds = trackLabel.querySelector('.now-playing-content').getBoundingClientRect();
    check(close(restoredTrackBounds.left + restoredTrackBounds.width / 2, spectrumBounds.left + spectrumBounds.width / 2, .2)
      && close(restoredTrackBounds.top + restoredTrackBounds.height / 2, spectrumBounds.top + spectrumBounds.height / 2, .2), '长曲名切回短曲名后仍保持居中');

    const onAir = doc().querySelector('on-air-indicator');
    window.cancelAnimationFrame(onAir.animation); onAir.animation = 0;
    const onAirLabel = onAir.querySelector('.on-air-label');
    onAir.render(6900); onAirLabel.style.fontVariationSettings = '"wdth" 100, "opsz" 28';
    const lightWeight = style(onAirLabel).fontWeight, lightInk = onAirLabel.getBBox().width;
    onAir.render(2900); onAirLabel.style.fontVariationSettings = '"wdth" 100, "opsz" 28';
    const heavyWeight = style(onAirLabel).fontWeight, heavyInk = onAirLabel.getBBox().width;
    check(lightWeight === '150' && heavyWeight === '850', 'N AIR 的字重属性在 150 与 850 之间变化');
    check(onAir.dataset.fonts === 'ready' && heavyInk > lightInk + .1, '固定字宽轴后，SF Pro 粗细变化仍真实改变字形');
    onAir.previousAxes = ''; onAir.sync();

    const barcode = doc().querySelector('barcode-code');
    window.clearInterval(barcode.timer); barcode.timer = null;
    barcode.motion = new BarcodeMotion(BARCODE_BARS.length, () => 0); barcode.render(0);
    const bars = [...barcode.querySelectorAll('[data-bar]')];
    const visibleBars = () => bars.filter(bar => bar.getAttribute('visibility') !== 'hidden');
    check(barcode.dataset.content === 'LATENITE' && bars.length === 34, 'LATENITE 条码由 34 根独立竖条绘制');
    barcode.render(6000); barcode.render(6000 + BARCODE_STEP);
    check(visibleBars().length === 32 && bars[0].getAttribute('visibility') === 'hidden' && bars[1].getAttribute('visibility') === 'hidden', '条码从左侧逐条消失');
    barcode.render(6000 + BARCODE_BARS.length * BARCODE_STEP + BARCODE_HOLD);
    check(visibleBars().length === 1 && visibleBars()[0] === bars[0], '条码从左侧逐条恢复');
    barcode.render(9000);
    check(style(barcode).color === 'rgb(191, 255, 97)', '条码偶发高亮使用严格反色荧光黄绿');
    barcode.render(9000 + 3 * BARCODE_FLASH);
    check(style(barcode).color === 'rgb(0, 0, 0)', '条码闪烁结束恢复黑色');
    barcode.motion = new BarcodeMotion(BARCODE_BARS.length); barcode.elapsed = 0; barcode.render(0); barcode.sync();

    const title = doc().querySelector('#bilingual-title');
    const KineticWordmark = title.constructor;
    KineticWordmark.playing.delete(title); KineticWordmark.playing.delete(brand); title.render(0); brand.render(0);
    const titleColor = style(title.querySelector('svg')).color;
    const brandColor = style(brand.querySelector('svg')).color;
    const glyphs = () => [...title.querySelector('.wordmark-phrase[visibility="visible"]').querySelectorAll('.wordmark-glyph')];
    const center = title.querySelector('svg').viewBox.baseVal.width / 2;
    const anchor = glyph => {
      const text = glyph.querySelector('text');
      const font = style(text);
      const context = doc().createElement('canvas').getContext('2d');
      context.font = `${font.fontWeight} ${font.fontSize} ${font.fontFamily}`;
      const metrics = context.measureText(text.textContent);
      // Measure the intrinsic font anchor. A stretched SVG outline's rounded
      // bounds would otherwise distort the spacing measurement at ninefold scale.
      const centerX = +text.getAttribute('x') + (metrics.actualBoundingBoxRight - metrics.actualBoundingBoxLeft) / 2;
      const matrix = glyph.transform.baseVal.consolidate().matrix;
      return matrix.a * centerX + matrix.e;
    };
    const first = anchor(glyphs()[0]), last = anchor(glyphs().at(-1));
    title.render(7500);
    const firstIn = anchor(glyphs()[0]), lastIn = anchor(glyphs().at(-1));
    check(firstIn > first && lastIn < last, '标题左右两端同时向中间收拢');
    check(close((firstIn - center) / (first - center), (lastIn - center) / (last - center), .002), '标题两端共用中心锚点');
    brand.render(2400);
    check(close(parseFloat(title.querySelector('feGaussianBlur').getAttribute('stdDeviation')),
      parseFloat(brand.querySelector('feGaussianBlur').getAttribute('stdDeviation'))), '标题与品牌在同一转场进度使用相同模糊量');
    title.render(7700); brand.render(2600);
    const titleScale = title.querySelector('.wordmark-phrase[visibility="visible"] .wordmark-glyph').transform.baseVal.consolidate().matrix.a;
    const brandScale = brand.querySelector('.wordmark-phrase[visibility="visible"] .wordmark-glyph').transform.baseVal.consolidate().matrix.a;
    check(title.getAttribute('effect') === 'stretch' && close(titleScale, 9)
      && close(parseFloat(title.querySelector('feGaussianBlur').getAttribute('stdDeviation')), 48), '标题保留九倍拉伸且模糊峰值与品牌一致');
    check(brand.getAttribute('effect') === 'blur' && close(brandScale, 1)
      && close(parseFloat(brand.querySelector('feGaussianBlur').getAttribute('stdDeviation')), 48), '品牌字标改用纯横向模糊且不拉伸字形');
    check(titleColor === 'rgb(191, 255, 97)' && style(title.querySelector('svg')).color === 'rgb(0, 0, 0)'
      && brandColor === 'rgb(64, 0, 158)' && style(brand.querySelector('svg')).color === 'rgb(191, 255, 97)', '标题切换高光为纯黑，常态荧光绿和品牌配色保持不变');
    title.syncPlayback(); brand.syncPlayback();

    const chat = terminal(); chat.pause(); chat.playback.clear(); chat.receive(event('message'));
    chat.receive(event('message', { message: '下一条普通弹幕' }));
    chat.pause();
    chat.playback.advance(1000); chat.render();
    check(chat.querySelectorAll('.terminal-entry').length === 1 && chat.querySelectorAll('.terminal-line').length === 1, '普通弹幕只显示一条正文');
    check(chat.querySelector('.terminal-meta .terminal-user').textContent === '测试用户'
      && chat.querySelector('.terminal-time').textContent === '2026-10-26 02:03:04', '普通弹幕恢复用户名与原始发送日期时间');
    const uiScale = parseFloat(style(doc().querySelector('#workspace')).getPropertyValue('--ui-scale'));
    check(close(parseFloat(style(chat).fontSize), 40 * uiScale)
      && close(parseFloat(style(chat.querySelector('.terminal-user')).fontSize), 36 * uiScale), '弹幕正文与用户名分别使用 40 和 36 px 字号');
    chat.playback.clear(); chat.receive(event('message', { message: '长弹幕保持日期和用户名可见。'.repeat(40) })); chat.pause();
    chat.playback.advance(2000); chat.render();
    const metadataBounds = chat.querySelector('.terminal-meta').getBoundingClientRect(), chatBounds = chat.getBoundingClientRect();
    check(metadataBounds.top >= chatBounds.top && metadataBounds.bottom <= chatBounds.bottom
      && chat.querySelector('.terminal-body').scrollTop > 0, '长正文单独滚动，用户名与日期时间保持可见');
    gift(225);
    check(style(chat.querySelector('.terminal-output')).visibility === 'hidden' && close(new window.DOMMatrix(style(chat.querySelector('.terminal-fill')).transform).a, .5), '礼物半程铺色时不提前显示文字');
    chat.playback.advance(1775); chat.render();
    check([...chat.querySelectorAll('.terminal-line')].map(line => line.textContent).join('/') === '测试用户/送出[小花花]', '礼物完整显示用户名和送出文案两行');
    check(style(chat.querySelector('.terminal-entry')).color === 'rgb(0, 0, 0)', '礼物文字为黑色');
    check(chat.querySelectorAll('.terminal-entry').length === 1, '礼物和普通弹幕不同时堆叠');

    const belts = [...doc().querySelectorAll('stream-marquee')];
    check(belts.length === 2 && new Set(belts.map(belt => belt.dataset.direction)).size === 2, '仅两条跑马灯且方向相反');
    check(new Set(belts.map(belt => belt.dataset.speed)).size === 2, '两条跑马灯速度不同');
    glow(450);
    check(belts.every(belt => close(+style(belt.querySelector('.marquee-highlight')).opacity, .5)
      && close(+style(belt.querySelector('[data-color="purple"]')).opacity, .25)
      && close(+style(belt.querySelector('[data-color="green"]')).opacity, .25)), '泛光半程文字和光晕同步混色');
    glow(GLOW_RISE + GLOW_HOLD / 2);
    check(belts.every(belt => +style(belt.querySelector('.marquee-highlight')).opacity === 1
      && +style(belt.querySelector('[data-color="purple"]')).opacity === 0
      && +style(belt.querySelector('[data-color="green"]')).opacity === 1), '泛光峰值完全变绿且无紫色光晕残留');
    for (let blink = 0; blink < 2; blink++) {
      const off = GLOW_BLINK_START + blink * (GLOW_BLINK_OFF + GLOW_BLINK_ON);
      glow(off + 1);
      check(belts.every(belt => +style(belt.querySelector('.marquee-highlight')).opacity === 0
        && +style(belt.querySelector('[data-color="purple"]')).opacity === 0
        && +style(belt.querySelector('[data-color="green"]')).opacity === 0), `第 ${blink + 1} 次闪烁同步熄灭高亮与光晕`);
      glow(off + GLOW_BLINK_OFF + 1);
      check(belts.every(belt => +style(belt.querySelector('.marquee-highlight')).opacity === 1
        && +style(belt.querySelector('[data-color="green"]')).opacity === 1), `第 ${blink + 1} 次闪烁同步恢复高亮与光晕`);
    }
    glow(GLOW_DURATION);
    check(belts.every(belt => +style(belt.querySelector('.marquee-highlight')).opacity === 0
      && +style(belt.querySelector('[data-color="purple"]')).opacity === 0
      && +style(belt.querySelector('[data-color="green"]')).opacity === 0), '泛光结束同时恢复紫色');
    check([...doc().querySelectorAll('.detection-chrome')].every(chrome => chrome.style.cssText === ''), '标签层不再写入框体抖动偏移');
    await rest();
    output.textContent = `${checks.join('\n')}\n${checks.length} 项浏览器检查全部通过`;
  } catch (error) { output.textContent = `${checks.join('\n')}\nFAIL ${error.message}`; }
};

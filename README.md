# StreamUI

本地直播视觉组件。页面左侧为实时声谱图（spectrogram）和波形，右侧为终端式直播弹幕机；黑底、TOYO 82 紫强调色 `#40009e`、三个独立可调整的细线框窗口。

## 运行

```sh
npm install
npm run bridge
```

保持桥接进程运行，在另一个终端启动页面：

```sh
npm run dev
```

打开 <http://127.0.0.1:5173/>。生产构建使用 `npm run build`，静态文件在 `dist/`，可用 `npm run preview` 预览。

`npm run bridge` 首次下载官方 Go 版 LAPLACE Event Bridge 0.3.21 并校验 SHA-256，缓存于忽略提交的 `.local/`，之后离线复用。只监听 `localhost:9696`。如果本机已有桥接服务，直接使用现有服务即可。

LAPLACE 类型包对 TypeScript 6/7 的 peer 声明存在冲突，项目 `.npmrc` 使用 `legacy-peer-deps` 保留原有 TypeScript 7 工具链。

## 直播弹幕

在 LAPLACE Chat 控制台的「Event Bridge 集成」中填写主机 `localhost`、端口 `9696`，不设密码，点击连接，并保持控制台开启。页面载入后自动接收该桥接服务的 `message`、`gift`、`superchat` 事件，断连后自动重连。弹幕采集与音频授权相互独立。

每条事件依次打印三行，行间默认间隔 160 ms：

1. 发送时间 `[HH:mm:ss]`，使用事件的标准化时间戳和浏览器本地时区。
2. 用户名、用户直播等级 `UL`，以及有佩戴时的粉丝牌名称和等级。
3. 正文快速逐字打印，默认约 10 ms/字；礼物显示 `送出 [礼物名称]`；SC 显示 `[¥金额] 留言正文`。打字光标跟随正文，上一条打完后再显示下一条。长正文的打字时长控制在约 1.2 秒内，繁忙时进一步加速；emoji 和组合字符作为完整字形显示。系统开启「减少动态效果」时直接显示完整正文。

礼物和 SC 的三行区域使用强调色底、黑色文字。UL 与粉丝牌等级分别显示，不混用；礼物/SC 没有 UL 字段时，沿用同房间、同用户已接收弹幕中的等级，未知显示 `UL —`。SC 使用 `priceNormalized`，不把原始平台计价单位当作人民币。

英文字体使用本机 `JetBrains Mono`，中文使用苹方 Thin（本机字体文件名为 `PingFang Light.ttf`，通过字体内部名称匹配 Thin 字形）。弹幕文字带轻微辉光，终端覆盖每 3 px 一条、厚 0.5 px 的细扫描线。消息排队逐条打印，繁忙时缩短行间隔，避免不同消息交错；正文自动折行。保留最近 200 条事件，重复事件去重。默认跟随最新消息，滚轮上翻后保留阅读位置，滚回底部恢复跟随。历史仅存于当前页面内存，刷新后从新事件开始。

接入使用 [官方 SDK](https://github.com/laplace-live/event-bridge/tree/master/packages/sdk)，字段以 [事件类型定义](https://chat.laplace.live/event-types/) 为准；[接入文档](https://laplace.live/chat/event-bridge)。

## 操作

- 单击黑色空白处请求音频共享。在 Windows 桌面版 Chrome / Edge 中选择整个屏幕，并启用共享系统音频。
- 拖动图形或弹幕区域移动窗口；拖动四边或角落调整大小。
- 按住 `Alt` 并左右拖动窗口，绕窗口中心旋转（每像素 0.5°）。松开鼠标结束调整。
- 右键窗口调整层级，或切换该窗口的「反色」开关。反色时窗口底色变为 `#40009e`，图形和边框变为黑色；三个窗口独立设置，已有声谱图历史即时换色。
- 位置、尺寸、角度、反色状态和层级保存在当前浏览器。
- `Esc` 停止采集；再次点击空白处重新授权。
- 窗口获得键盘焦点时，方向键移动，`Ctrl` + 方向键缩放，`Alt` + 左右方向键旋转，`Shift` 加速；`Shift` + `F10` 打开右键菜单。

常态页面没有按钮、图标、标题、说明或坐标文字。右键操作时才显示菜单。没有音频时声谱图为空，波形为基线；停止采集后保留最后的声谱图。无弹幕时终端仅显示闪烁光标。

## 音频与绘图

使用 `getDisplayMedia` 获取系统音频，`AnalyserNode` 进行 8192 点 FFT。声谱图横轴为时间（48 px/s，最新数据在右侧），纵轴为对数频率（下方低频，上方高频，30 Hz 至 20 kHz 或奈奎斯特频率），亮度表示强度。波形显示约 45 ms 的实际采样，带上升零交叉触发。

音频仅在本机分析，不录音、不上传、不回放。浏览器要求同时申请视频轨道；页面不绘制或处理画面，停止时一并释放全部轨道。

浏览器要求用户交互和每次共享确认，不能静默授权；详见 [Screen Capture 规范](https://www.w3.org/TR/screen-capture/#dom-mediadevices-getdisplaymedia)。如果后续需要无弹窗自动采集和 OBS 浏览器源，使用本地 [WASAPI loopback](https://learn.microsoft.com/en-us/windows/win32/coreaudio/loopback-recording) 采集进程向网页传送音频数据。当前版本尚未实现此本地采集服务。

## 源码

- `src/audio.ts`：系统音频采集、FFT、采集生命周期。
- `src/audio-scope.ts`：可复用的 `<audio-scope>` 声谱图 / 波形组件。
- `src/windows.ts`：基于 interact.js 的拖动、缩放，以及旋转、反色、层级和布局保存。
- `src/window-geometry.ts`：旋转坐标换算、边缘缩放与窗口边界约束；`npm test` 验证几何行为。
- `src/main.ts`：共享音频帧与页面生命周期。
- `src/chat-events.ts`：弹幕/礼物/SC 文本、时间与等级处理。
- `src/chat-terminal.ts`：官方 SDK 接入、三行打印队列、滚动与事件去重。
- `scripts/event-bridge.mjs`：下载、校验与启动官方本地桥接服务。

项目方向来自[前期讨论](https://chatgpt.com/share/6ad7190e-bcdc-83ee-a569-a500674a898b)：为 B 站直播和 OBS 构建本地视觉系统，复用 LAPLACE 采集弹幕和礼物。

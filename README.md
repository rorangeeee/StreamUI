# StreamUI

本地直播视觉组件。当前页面包含实时声谱图（spectrogram）和波形，黑底、强调色 `#5E6AD2`、两个可调整的矩形窗口。

## 运行

```sh
npm install
npm run dev
```

打开 <http://127.0.0.1:5173/>。生产构建使用 `npm run build`，静态文件在 `dist/`，可用 `npm run preview` 预览。

## 操作

- 单击黑色空白处请求音频共享。在 Windows 桌面版 Chrome / Edge 中选择整个屏幕，并启用共享系统音频。
- 拖动图形移动窗口；拖动四边或角落调整大小。
- 按住 `Alt` 并左右拖动窗口，绕窗口中心旋转（每像素 0.5°）。松开鼠标结束调整。
- 右键窗口调整层级，或切换该窗口的「反色」开关。反色时窗口底色变为 `#5E6AD2`，图形和边框变为黑色；两个窗口独立设置，已有声谱图历史即时换色。
- 位置、尺寸、角度、反色状态和层级保存在当前浏览器。
- `Esc` 停止采集；再次点击空白处重新授权。
- 窗口获得键盘焦点时，方向键移动，`Ctrl` + 方向键缩放，`Alt` + 左右方向键旋转，`Shift` 加速；`Shift` + `F10` 打开右键菜单。

常态页面没有按钮、图标、标题、说明、坐标文字或装饰。右键操作时才显示菜单。没有音频时声谱图为空，波形为基线；停止采集后保留最后的声谱图。

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

项目后续方向来自[前期讨论](https://chatgpt.com/share/6ad7190e-bcdc-83ee-a569-a500674a898b)：为 B 站直播和 OBS 构建本地视觉系统，复用 LAPLACE 采集弹幕和礼物，再接入三行终端式弹幕与联动效果。本阶段只实现音频组件。

# StreamUI Core

本地运行的直播场景宿主。核心负责 OBS 连接、弹幕数据、场景槽位、暂离状态和能力插件；场景网页负责布局、组件样式及转场画面。

此分支为公开版拆分。原自用版保留在 main。公开版使用独立端口、数据目录、启动项名称和可执行文件。

## 运行

需要 Node.js 22.18+ 和 .NET 10 SDK，当前原生宿主支持 Windows x64。

~~~sh
npm install
npm run host:package
npm run host
~~~

- 配置页：http://127.0.0.1:5281/
- OBS 浏览器源：http://127.0.0.1:5280/
- 可执行文件：StreamUI Core.exe

场景由开发者预先编写和登记。配置页用于主播在直播前调整 OBS、弹幕、插件和各预制场景的参数，不提供场景增删、入口文件、画布或转场编辑。将 OBS 浏览器源指向输出地址后，可在「预览」切换已有场景；预先绑定的 OBS 输出场景变化也会选择对应槽位，未绑定的 OBS 场景保持现有选择。

默认附带直播和暂离示例。在「设置 → 直播设置」编辑标题并保存，即可在预览和输出页看到更新。多个预制场景的参数面板会分别显示，各自保存到对应场景 ID，不需要切换直播输出。

配置页与自用版共用「预览」「设置」两页结构。外观可选择跟随系统、浅色或暗色，默认跟随系统，选择保存在当前浏览器中。

开发时先保持 Host 运行，再执行 npm run dev；开发配置页为 http://127.0.0.1:5373/config.html。

## 用户文件

双击 EXE 默认使用 %LOCALAPPDATA%/StreamUI/Core；npm run host 使用当前工程的 .local/core-data。可通过 --data-dir 指定其他目录。

- core-settings.json：连接设置、槽位、暂离槽位、启用的插件。
- scenes/：用户场景、素材、转场及场景设置页。
- scene-settings/：按场景 ID 保存的 JSON。
- plugins/：按插件 ID 放置的能力插件。
- plugin-settings/：按插件 ID 保存的 JSON。
- plugin-data/：插件自行使用的持久化目录。

首次创建用户目录时复制两个独立示例场景；已有场景及配置由用户维护，程序更新和重启不覆盖它们。开发者在启动前通过 core-settings.json 的 scenes、selectedSceneId 和 away.sceneId 登记场景、OBS 绑定和暂离场景；开发时遵循 docs/API.md 的槽位结构与路径要求。运行时的配置接口不接收或改写这些固定项。

## 接入接口

浏览器 SDK 位于固定地址 /sdk/streamui.js，详细说明见 docs/API.md。

~~~js
import { createClient } from '/sdk/streamui.js';

const client = createClient();
client.on('chat.message', message => renderMessage(message));
client.on('obs.sceneChanged', ({ name }) => updateScene(name));
client.on('away.changed', ({ enabled }) => updateAway(enabled));
client.start();
~~~

场景网页、组件表现和转场均不依赖内核中的固定布局。用户可以使用任意前端方式编写它们；一个场景就是一个 HTML 入口。示例中的标题、弹幕样式和淡入淡出转场都位于用户场景文件中。

插件增加数据或操作能力。系统运行时间插件示例见 examples/plugins/uptime；它同时演示 JSON 事件、二进制输出、配置面板及启停。音频、FFT、示波器、曲目读取不在核心中。

当前没有预设包的一键导入/导出。开发阶段迁移需要同时复制场景源码与素材、对应的 scene-settings JSON，以及所需插件和插件设置，再在启动前登记固定槽位。main 的 settings.json 和网页依赖个人版 Host 状态协议，不能直接作为 Core 预设加载；完整迁移需要 Core SDK 适配和对应的音频、媒体插件。Core 切换槽位会重建场景网页，跨布局保留弹幕历史和动画时钟也需要单独处理。

## 验证

~~~sh
npm test
npm run build
npm run host:test
~~~

原生测试使用独立用户目录及 5288/5289 端口，先在磁盘部署预制场景，再启动测试 Host。测试脚本自动构建示例插件。集成检查使用本机模拟 OBS、弹幕桥接和能力插件，不连接用户的 OBS。

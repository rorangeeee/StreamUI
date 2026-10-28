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

在配置页添加场景、设置网页入口与画布尺寸，将 OBS 浏览器源指向输出地址。填写槽位的 OBS 场景名称后，实际输出场景变化会选择对应槽位。未绑定的 OBS 场景保持现有选择。

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

首次创建用户目录时复制两个独立示例场景；已有场景及配置由用户维护，程序更新和重启不覆盖它们。移除槽位只取消登记，不删除用户文件。

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

## 验证

~~~sh
npm test
npm run build
npm run host:test
~~~

原生测试使用独立用户目录及 5288/5289 端口。集成检查使用本机模拟 OBS、弹幕桥接和能力插件，不连接用户的 OBS。

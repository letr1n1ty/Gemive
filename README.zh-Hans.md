# <img src="assets/icon-48.png" width="36" height="36" alt="Gemive logo" style="vertical-align: middle;"> Gemive

[English](README.md) | [简体中文](README.zh-Hans.md) | [繁體中文](README.zh-Hant.md)

Gemive 是一款 Chrome Manifest V3 扩展，为当前 Chrome 标签页提供实时翻译字幕和同声传译音频。

它捕获标签页音频，将 PCM 音频流传输到 Gemini Live Translate，渲染浮动字幕窗口，播放翻译后的同声传译音频，并可以将保存的转录导出为 Markdown。

## 预览

<p align="center">
  <img src="assets/previews/preview-1.png" width="800" alt="Gemive 实时字幕预览 1" />
</p>
<p align="center">
  <img src="assets/previews/preview-2.png" width="800" alt="Gemive 实时字幕预览 2" />
</p>
<p align="center">
  <img src="assets/previews/preview-3.png" width="800" alt="Gemive 实时字幕预览 3" />
</p>

## 功能

- 当前 Chrome 标签页的实时字幕
- 源语言字幕和翻译字幕显示
- Gemini Live Translate WebSocket 集成
- 翻译后的同声传译音频播放
- `chrome.tabCapture` 后的原始标签页音频直通
- 支持拖拽、缩放、样式控制和全屏重定位的浮动覆盖层
- 可选的仅启动器折叠模式，带可拖拽 Logo
- 单一活跃翻译会话，支持标签页切换
- 转录保存到 Chrome 本地存储
- 通过 Chrome Downloads API 导出 Markdown 转录
- Catppuccin Mocha 风格的深色 UI
- 繁体中文、简体中文和英文界面本地化
- 支持逗号分隔的多个 Gemini API 密钥，会话启动时随机选择

## 工作原理

```txt
当前 Chrome 标签页音频
→ chrome.tabCapture
→ 后台文档
→ AudioContext 直通
→ AudioWorklet 降混 + 重采样
→ PCM16 16 kHz 音频数据块
→ Gemini Live Translate
→ 字幕覆盖层 + 同声传译音频播放
→ 可选的 Markdown 转录导出
```

扩展一次只保持一个活跃翻译会话。如果另一个标签页正在翻译，弹出菜单会提供切换操作，而不是启动多个并行会话。

## 系统要求

- 支持 Manifest V3 的 Google Chrome 或 Chromium 浏览器
- 具有已配置实时翻译模型访问权限的 Gemini API 密钥
- 带有可播放音频的普通网页标签页

默认模型在 `core/settings.js` 中配置：

```js
model: 'gemini-3.5-live-translate-preview'
```

模型可用性取决于您的 Gemini API 访问权限，并可能随时间变化。

## 本地安装

1. 下载或克隆此仓库。
2. 打开 `chrome://extensions`。
3. 启用**开发者模式**。
4. 点击**加载已解压的扩展程序**。
5. 选择项目文件夹。
6. 打开**Gemive 设置**。
7. 添加您的 Gemini API 密钥。
8. 打开一个带有音频的标签页。
9. 点击 Gemive 工具栏图标开始翻译。

## API 密钥

要使用 Gemini API，请前往 Google AI Studio 并使用您的 Google 账号登录。打开 API Keys 页面。新账号通常会自动获得一个免费项目和 API 密钥。如果没有看到，只需点击 Create API key 创建一个。

Gemive 支持在设置页面添加一个或多个 Gemini API 密钥。

使用逗号分隔的密钥：

```txt
key_1, key_2, key_3
```

会话启动时，Gemive 会随机选择一个可用密钥。这在跨多个开发密钥测试时很有用，但不能绕过提供商的配额、政策或计费限制。

## 转录导出

默认启用转录保存。

保存的转录首先存储在 Chrome 本地存储中。导出时，Gemive 通过 Chrome Downloads API 创建一个 Markdown 文件：

```txt
Downloads/Gemive/Transcripts/gemive-transcripts-<timestamp>.md
```

Chrome 扩展无法静默写入任意本地文件系统路径，因此导出文件夹是 Downloads 下的相对路径。

## 隐私与数据流

Gemive 在本地处理音频，直到将编码的音频数据块发送到已配置的 Gemini Live Translate 端点。API 密钥和转录存储在 `chrome.storage.local` 中。

调试日志也存储在本地，并在持久化之前隐藏类似 API 密钥的值。

在发布或分发您自己的构建版本之前，请检查：

- `manifest.json` 权限
- Gemini API 使用和计费影响
- 您的目标用户是否需要启用转录保存
- 您的仓库许可和隐私声明

## 权限

| 权限 | 用途 |
| --- | --- |
| `tabCapture` | 捕获当前标签页音频 |
| `offscreen` | 在可见页面之外运行 AudioContext、WebSocket 和播放 |
| `storage` | 保存设置、转录和调试日志 |
| `activeTab` | 解析弹出菜单操作的活跃标签页 |
| `scripting` | 注入或重新打开字幕覆盖层 |
| `downloads` | 将转录导出为 Markdown 文件 |
| `tabs` | 跟踪活跃会话标签页和 URL 变化 |
| `<all_urls>` | 允许在普通网页上注入覆盖层 |

## 开发

本项目有意不设构建步骤。

```bash
npm install
npm run check
npm run zip
```

等效的直接命令：

```bash
node scripts/check-syntax.mjs
node scripts/package-zip.mjs
```

## 项目结构

```txt
assets/                 扩展图标和预览截图
background/             MV3 后台服务工作进程和会话编排
content/                浮动字幕覆盖层
core/                   共享设置、国际化、消息类型、转录缓冲区
options/                完整设置页面
popup/                  工具栏弹出菜单控件
storage/                设置和转录持久化
offscreen/              音频捕获、编码、Gemini 客户端、播放
scripts/                语法检查和打包辅助工具
docs/                   架构说明和手动测试计划
```

## 已知限制

- 一次只支持一个活跃翻译会话。
- 受限页面（如 `chrome://` 页面）无法运行内容覆盖层。
- 标签页音频捕获会改变浏览器音频路径；Gemive 通过 `AudioContext` 将捕获的音频路由回扬声器。
- 长时间运行的翻译取决于标签页音频可用性、Gemini 连接稳定性和提供商侧限制。
- 转录导出受 Chrome Downloads API 行为限制。

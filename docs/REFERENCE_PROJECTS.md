# Reference Projects

## 1. 结论

三个参考项目都在做“桌面悬浮辅助 + 截图/音频/AI”的方向，但成熟度和底层路线不同。

最终 MVP 应该主要沿 `pluely-master` 的路线实现：

- Tauri v2 + Rust + React。
- 原生透明悬浮窗口。
- macOS NSPanel。
- Rust 系统音频捕获。
- `contentProtected`。
- 截图前隐藏。

`free-cluely` 适合理解最小产品链路，但底层能力不够。`natively-cluely-ai-assistant` 最完整，但 Electron + Rust N-API + 多模块复杂度太高，不适合作为第一版骨架。

## 2. free-cluely

### 2.1 技术栈

- Electron。
- React/前端渲染。
- Node/Electron 主进程。
- 截图：`screenshot-desktop`。
- AI：Gemini/Ollama 等。
- 录音：浏览器 MediaRecorder 一类前端能力。

### 2.2 悬浮组件

实现方式：

- Electron `BrowserWindow`。
- 透明窗口。
- 无边框。
- always-on-top。
- 可移动。

它有悬浮窗/浮层能力，但更像一个 Electron overlay，而不是深度原生灵动岛。

### 2.3 录屏规避

实现方式：

- Electron `win.setContentProtection(true)`。

能力边界：

- 这是基础保护。
- 对系统和第三方录屏的表现依赖平台。
- 没有看到完整的 macOS NSPanel、WindowServer、Windows display affinity 等深层实现。

### 2.4 音频与 STT

实现方式：

- 更偏前端 MediaRecorder/浏览器采集。
- 不是完整系统音频实时捕获链路。

不足：

- 不能作为我们第一版“会议系统音频监听”的主方案。
- 如果要听会议对方声音，必须走系统音频捕获，而不是普通网页麦克风录制。

### 2.5 可借鉴

- 最小截图 + LLM 产品链路。
- Electron 浮层快速验证。
- 简单内容保护口径。

### 2.6 不采用

- 不用 Electron 做第一版主壳。
- 不把 MediaRecorder 当作系统音频方案。

## 3. pluely-master

### 3.1 技术栈

- Tauri v2。
- Rust。
- React/TypeScript。
- macOS: `tauri-nspanel`。
- 截图：Rust `xcap`。
- 音频：
  - macOS Core Audio Process Tap / Aggregate Device。
  - Windows WASAPI。
  - Linux PulseAudio。
- STT：前端/配置化 provider 调用。

### 3.2 悬浮灵动岛

关键实现：

- Tauri window config:
  - `width: 600`
  - `height: 54`
  - `decorations: false`
  - `transparent: true`
  - `visibleOnAllWorkspaces: true`
  - `skipTaskbar: true`
  - `contentProtected: true`
  - `focus: false`
  - `shadow: false`
- macOS 启动后把主窗口转成 NSPanel。
- 设置浮动层级。
- 设置 non-activating style mask。
- 设置 `FullScreenAuxiliary` 和 `CanJoinAllSpaces`。

结论：

- 它有我们要的悬浮灵动岛能力。
- 它的“原生”主要体现在窗口壳层和系统集成，UI 仍然可以由 WebView/React 渲染。

### 3.3 录屏规避

实现方式：

- Tauri `contentProtected`。
- macOS NSPanel。
- 窗口不进任务栏/Dock 的体验处理。

能力边界：

- 有基础保护，但仍不能承诺所有录屏软件不可见。
- 需要我们补充“截图前隐藏”和诊断测试。

### 3.4 音频与 STT

系统音频捕获：

- macOS 走 CoreAudio。
- Windows 走 WASAPI。
- Linux 走 PulseAudio。

STT 链路：

- Rust 捕获音频。
- VAD 检测语音片段。
- WAV/base64 或流式音频交给 STT。
- STT 返回文本后进入 AI 上下文。

可借鉴：

- 音频捕获模块拆分。
- Tauri event 把语音片段送给前端。
- 展开/收起窗口高度 command。
- macOS NSPanel 的落地方式。

### 3.5 不足

- STT Provider 不是以国内实时中文模型作为产品化 P0。
- 隐藏测试和产品文案边界还需要补。
- 设置/诊断可以更产品化。

## 4. natively-cluely-ai-assistant

### 4.1 技术栈

- Electron。
- React/前端。
- Rust native module。
- N-API。
- 多窗口架构。
- 多 STT/LLM Provider。
- 本地 Whisper 能力相关实现。
- 深层 macOS 原生窗口处理。

### 4.2 悬浮组件

实现方式：

- Electron 双窗口/多窗口。
- Launcher window。
- Overlay window。
- Rust native module 介入原生窗口属性。

特点：

- 比普通 Electron overlay 深得多。
- 通过 Rust/AppKit 修改 macOS 窗口行为。
- 更像成熟产品工程，而不是简单 demo。

### 4.3 录屏规避

实现方式包含：

- Electron `setContentProtection`。
- Rust native `applyStealthToWindow`。
- macOS AppKit/WindowServer 相关设置。
- `becomesKeyOnlyIfNeeded`。
- `hidesOnDeactivate = false`。
- `setSharingType: NSWindowSharingNone`。
- 私有/半私有窗口属性尝试，例如防激活行为。

结论：

- 它的隐藏能力是三个项目里最深的。
- 但复杂度、兼容性和签名风险也最高。
- 第一版只借鉴公开稳定的部分，不直接走私有 API。

### 4.4 音频与 STT

能力：

- native 系统音频捕获。
- 麦克风/系统音频更完整。
- 多 Provider。
- 本地 Whisper。

不作为第一版骨架原因：

- Electron + Rust N-API 会引入两套复杂运行时。
- native module 构建、签名、跨平台发布成本高。
- 第一版核心闭环不需要这么重。

## 5. 三者能力对比

| 项目 | 技术栈 | 悬浮气泡/灵动岛 | 录屏规避 | 系统音频 | STT 方案 | 适合我们借鉴程度 |
|---|---|---|---|---|---|---|
| free-cluely | Electron + React | 有，Electron overlay | 基础 `setContentProtection` | 弱 | Gemini/Ollama/简单录音链路 | 产品链路参考 |
| pluely-master | Tauri + Rust + React | 有，Tauri + NSPanel | `contentProtected` + 原生窗口 | 强 | 配置化 STT | 第一版主参考 |
| natively-cluely | Electron + Rust N-API | 有，多窗口 overlay | 最深，但复杂 | 强 | 多 Provider + Whisper | P1/P2 深水区参考 |

## 6. 对我们的落地启发

### 6.1 悬浮灵动岛

要做的是：

- 原生窗口壳层。
- WebView UI。
- 不抢焦点。
- 固定尺寸和稳定布局。
- 全局快捷键控制。

不是：

- 用纯网页 div 假装浮层。
- 一开始就用 SwiftUI/Cocoa 重写所有 UI。

### 6.2 隐藏

要做的是：

- Tauri `contentProtected`。
- macOS NSWindow sharing type。
- Windows display affinity。
- 自己截图前隐藏。
- 设置页诊断。

不是：

- 承诺所有录屏软件绝对不可见。
- 第一版依赖私有 API。

### 6.3 音频

要做的是：

- Rust 侧系统音频捕获。
- macOS CoreAudio。
- Windows WASAPI。
- VAD 分段。
- STT WebSocket。

不是：

- 浏览器麦克风 MediaRecorder。
- 第一版本地 Whisper。

### 6.4 架构

最佳折中：

```text
Tauri shell
  -> Rust native capabilities
  -> React island UI
  -> Domestic realtime STT
  -> OpenAI-compatible LLM
```

这条路线既能复刻参考项目的关键能力，又不会把第一版拖进 Electron native module 和私有 API 的复杂度。


# Technical Design

## 1. 总体决策

第一版选 `Tauri v2 + Rust + React/TypeScript`。

理由：

- 灵动岛、系统音频、截图、内容保护都需要原生能力，Rust 侧更适合承接这些能力。
- Tauri v2 原生支持透明窗口、无边框窗口、`contentProtected`、插件体系和 Rust command。
- 对比 Electron，Electron 做浮层和 Web UI 很快，但系统音频、NSPanel、录屏规避、窗口层级等仍然要写 native module。既然第一版已经明确要做“原生灵动岛 + 隐藏”，Tauri 更直接。
- Pluely 的实现路径已经证明 Tauri + Rust 可行：透明窗口 + macOS NSPanel + Rust 音频捕获 + Web UI。
- 平台范围明确收敛为 macOS-only；Windows/Linux 不做兼容、不预留实现。

## 2. 技术栈

### 2.1 客户端

- Runtime: Tauri v2
- Native: Rust
- UI: React + TypeScript
- Build: Vite
- Styling: Tailwind CSS 或 CSS Modules
- State: Zustand
- IPC: Tauri commands/events
- Local DB: SQLite via `tauri-plugin-sql`
- Secret storage: `tauri-plugin-stronghold` 或系统 keychain 封装
- Global shortcuts: `tauri-plugin-global-shortcut`

官方依据：

- Tauri window customization: https://v2.tauri.app/learn/window-customization/
- Tauri config: https://v2.tauri.app/reference/config/
- Tauri global shortcut plugin: https://v2.tauri.app/plugin/global-shortcut/
- Tauri SQL plugin: https://v2.tauri.app/plugin/sql/
- Tauri Stronghold plugin: https://v2.tauri.app/plugin/stronghold/

### 2.2 macOS 原生能力

- Window: `NSPanel` / non-activating panel
- Capture protection: `NSWindow.sharingType = .none` via Tauri `contentProtected` and native hook
- Spaces: `canJoinAllSpaces`, `fullScreenAuxiliary`
- Audio: Core Audio Process Tap + Aggregate Device
- Screenshot: `xcap` 或 ScreenCaptureKit 封装

官方依据：

- Apple NSPanel: https://developer.apple.com/documentation/appkit/nspanel
- Apple nonactivatingPanel: https://developer.apple.com/documentation/appkit/nswindow/stylemask-swift.struct/nonactivatingpanel
- Apple NSWindow sharing type none: https://developer.apple.com/documentation/appkit/nswindow/sharingtype-swift.enum/none
- Apple Core Audio taps: https://developer.apple.com/documentation/CoreAudio/capturing-system-audio-with-core-audio-taps
- Apple ScreenCaptureKit: https://developer.apple.com/documentation/screencapturekit/

## 3. 架构

```text
React UI
  ├─ Island UI
  ├─ Expanded Panel
  ├─ Settings Window
  └─ State Store
       │
       ▼
Tauri IPC Commands / Events
       │
       ▼
Rust Core
  ├─ Window Manager
  ├─ Stealth Manager
  ├─ Audio Capture Manager
  ├─ VAD / Segmenter
  ├─ STT Client
  ├─ LLM Client
  ├─ Screenshot Manager
  ├─ Prompt Orchestrator
  ├─ Storage
  └─ Diagnostics
```

## 4. 模块设计

### 4.1 Window Manager

职责：

- 创建主灵动岛窗口。
- 控制展开/收起高度。
- 控制显示/隐藏。
- 保持 always-on-top。
- 保持跨 Space 可见。
- 不抢焦点。

Tauri 配置建议：

```json
{
  "label": "main",
  "width": 600,
  "height": 54,
  "decorations": false,
  "transparent": true,
  "alwaysOnTop": true,
  "visibleOnAllWorkspaces": true,
  "skipTaskbar": true,
  "contentProtected": true,
  "focus": false,
  "shadow": false
}
```

Rust commands：

- `set_island_height(height: u32)`
- `set_island_visible(visible: bool)`
- `toggle_island_expanded()`
- `move_island(position: IslandPosition)`
- `open_settings_window()`

实现结论：

- 使用 Tauri 窗口承载 React UI。
- macOS 启动后把主窗口转换/增强为 `NSPanel`。
- 第一版不使用 SwiftUI 画 UI；Rust/AppKit 只负责窗口壳层，视觉仍由 React 实现。

### 4.2 Stealth Manager

职责：

- 开启 Tauri `contentProtected`。
- macOS 设置 NSWindow sharing type。
- macOS 设置非激活 Panel，减少切换焦点痕迹。
- 自己截图前隐藏窗口。
- 提供诊断截图。

关键点：

- `contentProtected` 是基础，不是完整答案。
- Apple 官方对 `NSWindowSharingNone` 明确提示：不要把它当成绝对隐藏手段。因此产品和技术都必须把它定义为 best-effort。
- 自己的截图链路可控，所以必须做到 100% 不截到灵动岛。

Rust commands：

- `enable_stealth_mode()`
- `disable_stealth_mode()`
- `capture_screen_without_island()`
- `run_capture_protection_test()`

### 4.3 Audio Capture Manager

P0：系统音频捕获。

macOS：

- 优先使用 Core Audio Process Tap + Aggregate Device。
- 捕获系统输出音频。
- 需要处理权限、设备变化、采样率转换。

Windows/Linux 不支持，不保留音频捕获实现。

内部音频格式：

- PCM signed 16-bit
- mono
- 16kHz 或 24kHz
- frame size: 20ms/40ms

Rust 事件：

- `audio_level_changed`
- `speech_started`
- `speech_chunk`
- `speech_ended`
- `audio_error`

### 4.4 VAD / Segmenter

职责：

- 把连续音频流切成适合 STT 的片段。
- 过滤静音。
- 降低 STT 成本。
- 为 Ask 提供最近上下文。

P0 方案：

- 先使用能量阈值 + 最短语音时长 + 静音尾部判断。
- 参数可配置但 UI 不暴露：
  - `min_speech_ms = 300`
  - `end_silence_ms = 700`
  - `max_segment_ms = 15000`
  - `pre_roll_ms = 300`

P1 方案：

- 接入 WebRTC VAD 或 Silero VAD。

结论：

- 第一版不用复杂神经网络 VAD。系统音频来源相对干净，能量阈值足以跑 MVP。

### 4.5 STT Client

P0 Provider：阿里云百炼/Model Studio 实时语音识别。

理由：

- 官方支持 WebSocket 实时流式识别。
- 面向中文普通话和方言有明确能力。
- 适合中国网络和国内产品落地。
- 认证方式和 WebSocket 协议清晰，适合 Rust 客户端实现。

官方依据：

- Model Studio real-time speech recognition: https://www.alibabacloud.com/help/en/model-studio/real-time-speech-recognition-user-guide
- Paraformer real-time API reference: https://help.aliyun.com/en/model-studio/paraformer-real-time-speech-recognition-api-reference/
- Speech-to-text models: https://www.alibabacloud.com/help/en/model-studio/asr-model

Provider 抽象：

```rust
#[async_trait]
pub trait SttProvider {
    async fn connect(&mut self, config: SttConfig) -> Result<()>;
    async fn send_audio(&mut self, chunk: AudioChunk) -> Result<()>;
    async fn finish_segment(&mut self) -> Result<()>;
    async fn close(&mut self) -> Result<()>;
}
```

统一事件：

```rust
pub enum SttEvent {
    Partial { text: String, ts_ms: u64 },
    Final { text: String, start_ms: u64, end_ms: u64 },
    Error { code: String, message: String },
}
```

P0 不做：

- 本地 Whisper。
- 多 Provider UI。
- 自动语言检测配置页。

但代码结构必须允许后续加：

- TencentCloudRealtimeAsrProvider
- VolcengineAsrProvider
- IflytekAsrProvider
- LocalWhisperProvider

### 4.6 LLM Client

P0 采用 OpenAI-compatible chat/completions 或 responses 风格适配层。

配置项：

- `base_url`
- `api_key`
- `model`
- `supports_vision`
- `temperature`

第一版默认能力：

- 文本建议：最近转写 -> LLM。
- 截图建议：截图 + 最近转写 -> vision LLM。

Prompt 输入：

- 最近 1-3 分钟 transcript。
- 用户当前模式。
- 当前截图 OCR/图片。
- 用户临时问题。

输出 schema：

```json
{
  "answer": "建议用户直接说出口的回答",
  "bullets": ["补充点 1", "补充点 2", "补充点 3"],
  "clarifying_question": "必要时反问对方的问题",
  "risk": "需要避免的表达"
}
```

### 4.7 Screenshot Manager

职责：

- 获取当前屏幕截图。
- 截图前隐藏灵动岛。
- 截图后恢复灵动岛。
- 压缩图片。
- 给 vision LLM 发送图片。

流程：

```text
capture_request
  -> remember island visible state
  -> hide island
  -> sleep 120-200ms
  -> capture active display
  -> restore island
  -> encode jpeg/webp
  -> attach to prompt
```

实现选择：

- P0 可复用 Rust 截图库，例如 `xcap`。
- 如果 macOS 权限和兼容性不稳定，再封装 ScreenCaptureKit。

### 4.8 Prompt Orchestrator

职责：

- 管理滚动上下文。
- 组装不同模式 prompt。
- 控制输出长度。
- 去掉重复转写。

上下文策略：

- 内存保留最近 3 分钟 transcript。
- Ask 默认取最近 90 秒。
- 如果用户触发截图，取最近 180 秒。
- 每条 transcript 带时间戳和 final/partial 状态。
- `ask_assistant` 是只读 transcript buffer 的独立 LLM 请求；它不能 stop/restart audio capture，也不能阻塞 VAD/STT 任务。
- Enter/Ask 的语义是“基于当前会议上下文求助”，不是“停止当前录音并发送这一段”。

模式：

- `interview`: 稳妥、结构化、像候选人口吻。
- `meeting`: 总结重点、提出下一步。
- `sales`: 回应异议、追问需求。
- `debug`: 直接分析屏幕和错误。

### 4.9 Storage

本地文件：

- SQLite: 设置、最近会话索引、快捷键配置。
- Stronghold/keychain: API Key。
- App log: 仅保存错误日志，不默认保存音频。

数据表：

```sql
settings(key TEXT PRIMARY KEY, value TEXT NOT NULL);
sessions(id TEXT PRIMARY KEY, started_at INTEGER, ended_at INTEGER, mode TEXT);
transcripts(id TEXT PRIMARY KEY, session_id TEXT, ts_ms INTEGER, text TEXT, is_final INTEGER);
```

P0 默认：

- 不持久化完整 transcript，除非用户打开“保存会议记录”。
- API Key 必须加密/安全存储。

### 4.10 Diagnostics

设置页必须有诊断按钮：

- Test STT。
- Test LLM。
- Test audio capture。
- Test screenshot hiding。
- Test shortcut conflict。

诊断结果直接影响可用性，不要只写日志。

## 5. 关键线程与异步模型

Rust 侧用 `tokio`。

建议任务：

- `audio_capture_task`
- `vad_task`
- `stt_ws_task`
- `llm_request_task`
- `window_event_task`

通信：

- `tokio::sync::mpsc` 传音频 chunk。
- `tauri::Emitter` 向前端发 UI 事件。
- `CancellationToken` 控制监听停止。

## 6. 错误处理

### 6.1 音频错误

- 设备不存在：提示选择默认输出设备。
- 权限缺失：跳转系统设置说明。
- 音频流中断：自动重启一次，失败后提示手动重连。

### 6.2 STT 错误

- 认证失败：进入设置页提示 key。
- 网络断开：指数退避重连。
- 服务限流：暂停发送，提示配额/频率。

### 6.3 LLM 错误

- Vision 不支持：截图功能提示换模型。
- 生成超时：保留 transcript，允许重试。
- 输出不是 JSON：fallback 为纯文本展示。

## 7. 安全策略

- Tauri command allowlist 严格限制。
- 前端不能直接读 API Key。
- API Key 只在 Rust provider 内使用。
- 默认不保存音频。
- 日志里禁止写入 API Key、完整 Authorization header、完整截图 base64。
- 不做远端自有服务器中转，避免第一版引入账号和合规成本。

## 8. 和三个参考项目的实现关系

### 8.1 free-cluely

可借鉴：

- Electron 透明 always-on-top 窗口。
- `setContentProtection(true)` 的基础思路。
- 简单截图 + LLM 的产品链路。

不采用：

- 不以 Electron 作为第一版壳。
- 不把浏览器 MediaRecorder 当成系统音频方案。

### 8.2 pluely-master

可借鉴：

- Tauri v2 + Rust + React。
- `600 x 54` 灵动岛窗口。
- `contentProtected`。
- macOS NSPanel。
- Rust 系统音频捕获。
- VAD 切片后送 STT。

第一版主要沿这个方向实现。

### 8.3 natively-cluely-ai-assistant

可借鉴：

- 深层 macOS stealth window。
- Rust native module 承接音频、窗口、键盘等底层能力。
- 多 Provider 设计。

不采用：

- 第一版不做 Electron + N-API 混合复杂架构。
- 不做隐形键盘输入、复杂浏览器扩展和 premium 体系。

## 9. 平台支持计划

### 9.1 当前范围: macOS

必须跑通：

- 灵动岛。
- NSPanel。
- 系统音频。
- STT。
- LLM。
- 截图隐藏。

### 9.2 非目标: Windows/Linux

不兼容、不预留、不写平台 fallback。后续只有在产品范围明确变化后再重新设计。

## 10. 未决问题与处理结论

| 问题 | 结论 |
|---|---|
| 灵动岛要不要纯原生绘制 | P0 不做。用 Tauri WebView 渲染 UI，原生负责窗口层级和系统能力。 |
| 要不要 Electron | 不选。第一版底层能力密集，Tauri + Rust 更合适。 |
| 要不要本地 Whisper | P0 不做。延迟、包体、模型下载、设备性能都会拖慢 MVP。 |
| 要不要麦克风 | P0 不做。先捕获会议系统音频，解决对方问题转写。 |
| 是否能 100% 规避录屏 | 不能承诺。实现 best-effort + 自己截图链路 100% 隐藏。 |
| 国内 STT 选哪个 | P0 选阿里云百炼实时语音识别；腾讯云作为 P1 备选。 |

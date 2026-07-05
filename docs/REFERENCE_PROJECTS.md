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
- 自己截图前隐藏。
- 设置页诊断。

不是：

- 承诺所有录屏软件绝对不可见。
- 第一版依赖私有 API。

### 6.3 音频

要做的是：

- Rust 侧系统音频捕获。
- macOS CoreAudio。
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

## 7. 源码调用链备忘

本节记录 2026-06-22 追代码得到的关键链路，方便后续回顾和照抄实现。这里的“源码位置”指本机参考仓库路径。

### 7.1 Anarlog: 新建 note 后底部气泡 Start listening

参考仓库：

- `/Users/zhujianye/maidang/anarlog`

前端入口：

- `/Users/zhujianye/maidang/anarlog/apps/desktop/src/session/components/floating/listen.tsx`
  - `ListenButton` 渲染底部气泡里的按钮。
- `/Users/zhujianye/maidang/anarlog/apps/desktop/src/session/components/listen-action.tsx`
  - `ListenActionButton` 在按钮点击时调用 `useStartListening(sessionId)`。
- `/Users/zhujianye/maidang/anarlog/apps/desktop/src/stt/useStartListening.ts`
  - `useStartListening` 组装 `CaptureParams`。
  - 关键参数：`onboarding: false`，这会走默认 live session 路线。
  - 最终调用 listener store 的 `start(params, options)`。

前端状态机和 Tauri command：

- `/Users/zhujianye/maidang/anarlog/apps/desktop/src/store/zustand/listener/general.ts`
  - `start` 做 session id、运行状态、batch 冲突检查。
  - 然后调用 `startLiveSession(...)`。
- `/Users/zhujianye/maidang/anarlog/apps/desktop/src/store/zustand/listener/general-live.ts`
  - 先订阅三个事件：
    - `captureLifecycleEvent`
    - `captureStatusEvent`
    - `captureDataEvent`
  - 再调用 `listenerCommands.startCapture(params)`。
  - `listenerCommands.startCapture` 对应 Tauri command `plugin:transcription|start_capture`。
  - 收到 lifecycle `started` 后才设置 UI active，并调用 `iconCommands.setRecordingIndicator(true)`。

后端插件入口：

- `/Users/zhujianye/maidang/anarlog/plugins/transcription/src/lib.rs`
  - 注册 `listener::commands::start_capture`。
  - 启动 `RootActor`，并把 `Arc<dyn AudioProvider>` 注入 actor runtime。
- `/Users/zhujianye/maidang/anarlog/plugins/transcription/src/listener/commands.rs`
  - `start_capture(app, params)` 调用 `app.listener().start_capture(params)`。
- `/Users/zhujianye/maidang/anarlog/plugins/transcription/src/listener/ext.rs`
  - `start_capture` 把 `CaptureParams` 转成 `SessionParams`。
  - 向 `RootActor` 发送 `RootMsg::StartSession`。

Actor 链路：

- `/Users/zhujianye/maidang/anarlog/crates/listener-core/src/actors/root.rs`
  - `RootActor::StartSession` 调用 `spawn_session_supervisor(ctx)`。
  - 成功后 emit lifecycle active。
- `/Users/zhujianye/maidang/anarlog/crates/listener-core/src/actors/session/supervisor/children.rs`
  - session supervisor 启动 `SourceActor`、`RecorderActor`、`ListenerActor`。
- `/Users/zhujianye/maidang/anarlog/crates/listener-core/src/actors/source/mod.rs`
  - `SourceActor::pre_start` 调用 `start_source_loop`。
  - 同时启动 silence playback、device watcher、pipeline。
- `/Users/zhujianye/maidang/anarlog/crates/listener-core/src/actors/source/stream.rs`
  - `ChannelMode::determine(onboarding)` 决定采集模式。
  - `onboarding: false` 时默认是 `MicAndSpeaker`。
  - `MicAndSpeaker` 调用 `ctx.audio.open_capture(config)`。
  - 采集 stream 被长期持有在 `tokio::spawn` 的循环里，直到 cancel 或 stream 结束。

音频实现：

- `/Users/zhujianye/maidang/anarlog/crates/audio-actual/src/lib.rs`
  - `ActualAudio` 实现 `AudioProvider`。
  - `open_capture` 委托给 `capture::open_capture(config)`。
- `/Users/zhujianye/maidang/anarlog/crates/audio-actual/src/capture/mod.rs`
  - `open_capture` 先 `setup_mic_stream(...)`。
  - `sleep(50ms)`。
  - 再 `setup_speaker_stream(...)`。
  - 最后 `open_dual(...)`，输出包含 mic 和 speaker 的 `CaptureFrame`。
- `/Users/zhujianye/maidang/anarlog/crates/audio-actual/src/capture/stream.rs`
  - 把 mic/speaker resample 成固定 chunk。
  - `run_dual_loop` 用 `tokio::select!` 同时消费两路音频。
  - 输出 `CaptureFrame { raw_mic, raw_speaker, aec_mic }`。
- `/Users/zhujianye/maidang/anarlog/crates/audio-actual/src/mic.rs`
  - 麦克风用 `cpal` input stream。
  - 这一路会触发 macOS 麦克风录音权限和顶部录音标识。
- `/Users/zhujianye/maidang/anarlog/crates/audio-actual/src/speaker/macos.rs`
  - system audio 使用 CoreAudio Process Tap。
  - `TapDesc::with_mono_global_tap_excluding_processes(...)`。
  - `create_process_tap()`。
  - private aggregate device。
  - `tap_list`。
  - `create_io_proc_id(...)`。
  - `device_start(...)`。

权限与 bundle：

- `/Users/zhujianye/maidang/anarlog/apps/desktop/src-tauri/Info.plist`
  - 有 `NSMicrophoneUsageDescription`。
  - 有 `NSAudioCaptureUsageDescription`。
- `/Users/zhujianye/maidang/anarlog/apps/desktop/src-tauri/Entitlements.plist`
  - 有 `com.apple.security.device.audio-input`。
- `/Users/zhujianye/maidang/anarlog/apps/desktop/src-tauri/tauri.conf.json`
  - `app.macOSPrivateApi: true`。
  - `bundle.macOS.entitlements: "./Entitlements.plist"`。
- `/Users/zhujianye/maidang/anarlog/plugins/permissions/src/ext.rs`
  - `request_microphone` 调用 `AVCaptureDevice::requestAccessForMediaType`。
  - `request_system_audio` 会 `play_silence()`，然后 `audio.probe_speaker()`，用实际创建 speaker stream 的方式触发/验证系统音频权限。

技术方案结论：

- Anarlog 的可用链路不是“只开 speaker tap”。
- 新建 note 后的 `Start listening` 默认是 `MicAndSpeaker`。
- 顶部录音标识很可能至少部分来自麦克风 input stream。
- 它的稳定性来自 actor/supervisor 长期持有 capture stream，并能处理 lifecycle、error、restart。
- 如果 Meetly 要照抄 Anarlog 到 M3，应该抄：
  - `AudioProvider` 抽象。
  - `CaptureStream`。
  - `MicAndSpeaker` 启动顺序。
  - 长期持有 stream 的后台任务。
  - lifecycle/status/data 事件。
  - 权限 probe 逻辑。

### 7.2 Pluely: system audio / speaker tap + VAD

参考仓库：

- `/Users/zhujianye/maidang/cluely-style-app/pluely-master`

前端入口：

- `/Users/zhujianye/maidang/cluely-style-app/pluely-master/src/pages/app/components/speech/index.tsx`
  - speech UI 使用 `useSystemAudio()`。
  - 点击录音按钮调用 `startCapture()` 或 `stopCapture()`。
- `/Users/zhujianye/maidang/cluely-style-app/pluely-master/src/hooks/useSystemAudio.ts`
  - `startCapture` 先调用 `check_system_audio_access`。
  - 通过后设置 `capturing`、popover、conversation state。
  - VAD 模式下先调用 `stop_system_audio_capture` 清理旧任务。
  - 再调用 `start_system_audio_capture({ vadConfig, deviceId })`。
  - 前端监听 `speech-detected` 事件，拿到 base64 WAV 后转成 `Blob`，再走 STT 和 AI。

Tauri 注册点：

- `/Users/zhujianye/maidang/cluely-style-app/pluely-master/src-tauri/src/lib.rs`
  - `AudioState` 持有：
    - `stream_task`
    - `vad_config`
    - `is_capturing`
  - `generate_handler!` 注册：
    - `speaker::start_system_audio_capture`
    - `speaker::stop_system_audio_capture`
    - `speaker::check_system_audio_access`
    - `speaker::request_system_audio_access`
    - `speaker::get_input_devices`
    - `speaker::get_output_devices`

后端 command：

- `/Users/zhujianye/maidang/cluely-style-app/pluely-master/src-tauri/src/speaker/commands.rs`
  - `start_system_audio_capture(app, vad_config, device_id)`：
    - 检查是否已有 `stream_task`。
    - 更新 VAD 配置。
    - `SpeakerInput::new_with_device(device_id)`。
    - `input.stream()`。
    - 校验 sample rate。
    - emit `capture-started`。
    - `tokio::spawn` 后台任务。
    - VAD enabled 时跑 `run_vad_capture`。
    - VAD disabled 时跑 `run_continuous_capture`。
  - `run_vad_capture`：
    - 从 speaker stream 读取 `f32` sample。
    - 按 `hop_size` 分块。
    - noise gate。
    - RMS/peak 判断 speech。
    - 收集 pre-speech 和 speech buffer。
    - 结束后转 WAV base64。
    - emit `speech-detected`。
  - `stop_system_audio_capture`：
    - abort `stream_task`。
    - 等待清理。
    - 设置 `is_capturing=false`。
    - emit `capture-stopped`。
  - `check_system_audio_access`：
    - 只尝试 `SpeakerInput::new()`。
    - 成功返回 true，失败返回 false。
  - `request_system_audio_access`：
    - macOS 打开系统设置 `Privacy_AudioCapture`。

macOS speaker tap 实现：

- `/Users/zhujianye/maidang/cluely-style-app/pluely-master/src-tauri/src/speaker/macos.rs`
  - 可列出 input/output devices。
  - `SpeakerInput::new(device_id)` 会先选择 default output device 或指定 output device。
  - 创建 output sub-device dictionary。
  - 创建 CoreAudio mono global process tap：
    - `TapDesc::with_mono_global_tap_excluding_processes(...)`
    - `create_process_tap()`
  - 创建 private aggregate device：
    - `is_private`
    - `is_stacked`
    - `tap_auto_start`
    - `main_sub_device`
    - `sub_device_list`
    - `tap_list`
  - `start_device` 中：
    - `AggregateDevice::with_desc(...)`
    - `create_io_proc_id(...)`
    - `device_start(...)`
  - IO callback 里把 CoreAudio buffer 转成 `f32`，推入 ring buffer。
  - `SpeakerStream` 实现 `Stream<Item = f32>`。

bundle / 权限文件：

- `/Users/zhujianye/maidang/cluely-style-app/pluely-master/src-tauri/tauri.conf.json`
  - `app.macOSPrivateApi: true`。
  - window 配置包括透明、无边框、`contentProtected`、`visibleOnAllWorkspaces`、`skipTaskbar`、`focus:false`。
  - `bundle.resources` 包含 `info.plist`。
- `/Users/zhujianye/maidang/cluely-style-app/pluely-master/src-tauri/info.plist`
  - 有 `NSMicrophoneUsageDescription`。
  - 有 `NSAudioCaptureUsageDescription`。
  - 有 `NSPrivacyAccessedAPITypes` / `NSPrivacyAccessedAPICategoryAudioProcessing`。
  - 文件里也写了 `com.apple.security.device.microphone` 和 `com.apple.security.device.audio-input`。
  - 注意：Pluely 的 `tauri.conf.json` 没有像 Anarlog 那样显式配置 `bundle.macOS.entitlements` 或 `bundle.macOS.infoPlist`。复制时需要按 Tauri v2 当前项目方式确认这些 key 是否真的进入最终 `.app` 的 `Contents/Info.plist` 和签名 entitlements。

技术方案结论：

- Pluely 是“纯 system audio / speaker tap”方案，不默认开麦克风。
- 重要修正：Pluely 点左侧耳机 icon 后，macOS 顶部仍会出现音频/录音隐私标识。
  - 这个标识不是因为它默认开了麦克风。
  - 原因是 CoreAudio Process Tap 走 macOS `AudioCapture` 权限，也会触发系统音频捕获的隐私提示。
  - 因此“耳机点击后顶部是否出现音频标识”可以作为 Pluely-style speaker tap 是否真正启动的一个外部信号。
- 它更接近 Meetly M3 的最小目标：点击耳机后监听系统输出、VAD、emit level/segment。
- 但 Pluely 的 macOS aggregate device 方案绑定了 output device：
  - `main_sub_device`
  - `sub_device_list`
  - `tap_list`
- Anarlog 的 speaker tap 更简化，只创建 private aggregate device + tap list，不绑定 default output device。
- 如果目标是“只做系统音频监听”，Pluely 的产品链路更直接。
- 如果目标是“复刻 Anarlog Start listening 的录音标识和会议录音体验”，需要走 Anarlog 的 `MicAndSpeaker`。

### 7.3 对 Meetly M3 的判断

当前现象“点击后弹权限，但 mac 顶部没有录音标识”在 Pluely-style 路线下应该视为失败信号：权限弹窗通过只说明 bundle/TCC 请求到了某一步，不代表 `create_process_tap`、private aggregate device、`device_start` 和长期持有 stream 已经真正跑起来。

决策：

- Meetly M3 优先复制 Pluely 的系统音频链路，而不是 Glass 的 ScreenCaptureKit sidecar。
- 点击耳机后预期行为：
  - macOS 顶部出现音频/录音隐私标识。
  - 后端成功创建 CoreAudio Process Tap。
  - 成功创建并启动 private aggregate device。
  - 后端长期持有 `SpeakerStream` / capture task，不能函数返回后 drop。
  - UI level 在播放系统声音时变化。
- 如果顶部没有音频标识，优先排查：
  - `NSAudioCaptureUsageDescription` 是否进入最终 `.app/Contents/Info.plist`。
  - `com.apple.security.device.audio-input` 是否进入签名 entitlements。
  - `Privacy_AudioCapture` TCC 是否对应当前 bundle identifier。
  - `create_process_tap()` 是否真实成功。
  - `AggregateDevice::with_desc(...)`、`create_io_proc_id(...)`、`device_start(...)` 是否真实成功。
  - stream/capture task 是否被立即 drop。

M3 推荐拆成两步验证：

1. 系统音频最小闭环：
   - 参考 Pluely。
   - 点击耳机后创建 speaker tap。
   - 长期持有 `SpeakerStream`。
   - UI 显示 level。
   - 播放系统声音时 level 变化。
2. Anarlog 等价 Start listening：
   - 参考 Anarlog。
   - 点击后同时打开 mic + speaker。
   - 后端长期持有 capture stream。
   - lifecycle event 驱动 UI 状态。
   - 这一路应该更接近 macOS 顶部录音标识的行为。

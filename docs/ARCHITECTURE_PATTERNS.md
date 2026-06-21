# Architecture Patterns

## 1. 结论

第一版采用 `Local-first Tauri Desktop + BYOK Provider Adapter` 架构。

工程上分成四层：

```text
Presentation Layer
  -> Application Layer
  -> Native Capability Layer
  -> Provider / Infrastructure Layer
```

核心规则：

- React 只负责 UI 和用户交互，不直接调用第三方模型服务。
- Rust Application Layer 负责业务编排。
- Rust Native Capability Layer 负责窗口、音频、截图、隐藏、快捷键等系统能力。
- Provider Layer 负责 STT/LLM 的外部服务适配。
- API Key 只在 Rust 侧安全存储和使用，前端不持有明文。

## 2. 分层设计

### 2.1 Presentation Layer

位置：

```text
src/
  app/
  components/
  stores/
  hooks/
```

职责：

- 灵动岛收起态。
- 展开面板。
- 设置页。
- 诊断页。
- 前端状态展示。
- 用户操作转成 Tauri command。
- 监听 Tauri event 更新 UI。

不能做：

- 不保存 API Key 明文。
- 不直接请求 STT/LLM。
- 不实现音频采集。
- 不实现截图。
- 不做 provider 签名。

推荐模式：

- Container + Presentational Components。
- Zustand 做 UI state。
- Tauri event subscription 做外部状态输入。
- 不在组件里写复杂业务编排。

### 2.2 Application Layer

位置：

```text
src-tauri/src/app/
  assistant_service.rs
  listening_service.rs
  screenshot_service.rs
  settings_service.rs
  diagnostics_service.rs
```

职责：

- 编排听写、转写、Ask、截图分析。
- 管理状态机。
- 组合 Native Capability 和 Provider。
- 做错误归一化。
- 向前端发事件。

典型服务：

- `ListeningService`: start/stop listening。
- `AssistantService`: ask assistant。
- `ScreenshotService`: capture and ask。
- `SettingsService`: save/test config。
- `DiagnosticsService`: run tests。

设计模式：

- Service Layer。
- Command Handler。
- State Machine。
- Event-driven UI updates。

### 2.3 Native Capability Layer

位置：

```text
src-tauri/src/native/
  window/
  stealth/
  audio/
  screenshot/
  shortcut/
```

职责：

- 封装系统 API。
- 屏蔽 macOS/Windows 差异。
- 给 Application Layer 提供稳定接口。

模块：

- `WindowManager`
- `StealthManager`
- `AudioCaptureManager`
- `ScreenshotManager`
- `ShortcutManager`

设计模式：

- Facade: 对上提供统一能力。
- Strategy: macOS/Windows 不同实现。
- RAII Guard: 临时隐藏窗口后自动恢复。

示例：

```rust
pub struct HiddenWindowGuard {
    window: tauri::WebviewWindow,
    was_visible: bool,
}

impl Drop for HiddenWindowGuard {
    fn drop(&mut self) {
        if self.was_visible {
            let _ = self.window.show();
        }
    }
}
```

### 2.4 Provider / Infrastructure Layer

位置：

```text
src-tauri/src/providers/
  stt/
  llm/
src-tauri/src/storage/
src-tauri/src/config/
```

职责：

- 适配外部 STT。
- 适配外部 LLM。
- 本地数据库。
- 安全存储。
- 日志。

设计模式：

- Adapter: 不同 Provider 转成统一内部接口。
- Repository: 设置、会话、转写存储。
- Factory: 根据配置创建 Provider。
- DTO Mapping: 外部协议和内部事件分离。

## 3. 核心模块拆分

```text
src-tauri/src/
  main.rs
  lib.rs
  commands/
    listening.rs
    assistant.rs
    settings.rs
    screenshot.rs
    diagnostics.rs
  app/
    listening_service.rs
    assistant_service.rs
    screenshot_service.rs
    settings_service.rs
    diagnostics_service.rs
    context_buffer.rs
    prompt_orchestrator.rs
  native/
    window/
      mod.rs
      macos.rs
      windows.rs
    stealth/
      mod.rs
      macos.rs
      windows.rs
    audio/
      mod.rs
      macos_coreaudio.rs
      windows_wasapi.rs
      vad.rs
    screenshot/
      mod.rs
    shortcut/
      mod.rs
  providers/
    stt/
      mod.rs
      aliyun_realtime.rs
      tencent_realtime.rs
    llm/
      mod.rs
      openai_compatible.rs
  storage/
    settings_repository.rs
    secret_store.rs
    transcript_repository.rs
  domain/
    audio.rs
    transcript.rs
    assistant.rs
    provider.rs
    error.rs
```

## 4. IPC 边界

### 4.1 Tauri Commands

前端只能通过 command 触发动作：

```rust
#[tauri::command]
async fn start_listening(app: tauri::AppHandle) -> Result<(), AppError>;

#[tauri::command]
async fn stop_listening(app: tauri::AppHandle) -> Result<(), AppError>;

#[tauri::command]
async fn ask_assistant(input: AskInput) -> Result<(), AppError>;

#[tauri::command]
async fn capture_and_ask(input: CaptureAskInput) -> Result<(), AppError>;

#[tauri::command]
async fn save_provider_config(input: ProviderConfigInput) -> Result<(), AppError>;
```

Command 规则：

- command 只做参数校验和调用 service。
- command 不直接操作系统 API。
- command 不直接拼 prompt。
- command 不直接请求第三方 Provider。

### 4.2 Tauri Events

后端通过 event 推送状态：

```text
audio_level_changed
transcript_partial
transcript_final
assistant_delta
assistant_done
assistant_error
listening_state_changed
stealth_status_changed
diagnostics_result
```

事件规则：

- event payload 不包含 API Key。
- event payload 不包含完整截图 base64。
- transcript 可以包含最近文本，但默认不持久化。
- error 要包含用户可读 message 和开发可查 code。

## 5. Domain Model

核心类型：

```rust
pub enum ListeningState {
    Idle,
    Starting,
    Listening,
    Paused,
    Error,
}

pub struct TranscriptSegment {
    pub id: String,
    pub text: String,
    pub start_ms: u64,
    pub end_ms: u64,
    pub is_final: bool,
}

pub enum AssistantMode {
    Interview,
    Meeting,
    Sales,
    Debug,
}

pub struct AssistantSuggestion {
    pub answer: String,
    pub bullets: Vec<String>,
    pub clarifying_question: Option<String>,
    pub risk: Option<String>,
}
```

## 6. Provider 抽象

### 6.1 STT Provider

```rust
#[async_trait::async_trait]
pub trait SttProvider: Send + Sync {
    async fn start(&mut self, config: SttConfig) -> anyhow::Result<()>;
    async fn push_audio(&mut self, chunk: AudioChunk) -> anyhow::Result<()>;
    async fn finish_segment(&mut self) -> anyhow::Result<()>;
    async fn shutdown(&mut self) -> anyhow::Result<()>;
}
```

Provider 不直接更新 UI，只返回内部事件：

```rust
pub enum SttEvent {
    Partial { text: String, timestamp_ms: u64 },
    Final { text: String, start_ms: u64, end_ms: u64 },
    Error { code: String, message: String },
}
```

### 6.2 LLM Provider

```rust
#[async_trait::async_trait]
pub trait LlmProvider: Send + Sync {
    async fn complete(&self, request: LlmRequest) -> anyhow::Result<LlmResponse>;
    async fn stream(&self, request: LlmRequest) -> anyhow::Result<LlmStream>;
}
```

第一版只实现：

- `OpenAiCompatibleProvider`

后续可以加：

- `AliyunDashscopeProvider`
- `DeepSeekProvider`
- `LocalModelProvider`

## 7. State Machine

监听状态：

```text
Idle
  -> Starting
  -> Listening
  -> Paused
  -> Stopping
  -> Idle

Listening
  -> Error
Error
  -> Starting
  -> Idle
```

Ask 状态：

```text
Ready
  -> BuildingContext
  -> Requesting
  -> Streaming
  -> Done
  -> Ready

Requesting/Streaming
  -> Failed
Failed
  -> Ready
```

截图状态：

```text
Ready
  -> HidingIsland
  -> Capturing
  -> RestoringIsland
  -> Asking
  -> Done
```

状态机规则：

- 不能在 `Starting` 重复 start。
- `stop_listening` 必须幂等。
- 截图失败也必须恢复灵动岛。
- Ask 失败不能清空 transcript。

## 8. 错误模型

统一错误：

```rust
pub enum AppError {
    PermissionDenied { capability: String, message: String },
    ProviderAuthFailed { provider: String, message: String },
    ProviderRateLimited { provider: String, message: String },
    NetworkFailed { message: String },
    AudioCaptureFailed { message: String },
    ScreenshotFailed { message: String },
    StealthUnavailable { message: String },
    ConfigInvalid { field: String, message: String },
    Internal { message: String },
}
```

错误规则：

- 外部 Provider 错误码保留在 diagnostics。
- UI 只展示可行动信息。
- 日志不写 API Key。
- 音频、截图、转写默认不进入错误日志正文。

## 9. 并发模型

Runtime:

- Rust `tokio`。

任务：

```text
audio_capture_task
  -> vad_task
  -> stt_task
  -> context_buffer

assistant_task
  -> llm_stream_task

shortcut_task
  -> command dispatch
```

通信：

- `tokio::sync::mpsc` 传音频和 STT 事件。
- `tokio::sync::watch` 传状态。
- `CancellationToken` 管理 start/stop。
- `tauri::Emitter` 推送前端事件。

规则：

- 音频捕获不能阻塞 UI。
- LLM 请求不能阻塞音频捕获。
- stop listening 必须取消音频和 STT 任务。
- app 退出时必须关闭 WebSocket 和音频设备。

## 10. BYOK 数据边界

本地安全存储：

- STT API Key。
- LLM API Key。
- Secret Key。

本地普通存储：

- provider 类型。
- model。
- base URL。
- 快捷键。
- UI 偏好。
- 隐藏模式开关。

内存短期缓存：

- 最近 1-3 分钟 transcript。
- 当前截图临时 bytes。
- 当前 LLM streaming buffer。

不存：

- 默认不存完整音频。
- 默认不存完整截图。
- 默认不存完整会议记录。

云端：

- P0 没有我们的云端。
- 没有登录。
- 没有扣点。
- 没有 usage metering。

## 11. 设计模式清单

| 场景 | 模式 | 用法 |
|---|---|---|
| STT/LLM 多服务商 | Adapter | 每个 Provider 适配成统一 trait |
| macOS/Windows 系统能力差异 | Strategy | 按平台编译不同实现 |
| 业务编排 | Service Layer | Assistant/Listening/Screenshot service |
| 前端触发后端能力 | Command Handler | Tauri command 只调用 service |
| 实时状态更新 | Event-driven | Rust emit event，React subscribe |
| 窗口临时隐藏 | RAII Guard | 确保截图失败也恢复窗口 |
| 本地配置读取 | Repository | settings/secret/transcript repository |
| Provider 创建 | Factory | 根据本地配置创建具体实现 |
| 监听/Ask/截图状态 | State Machine | 防止重复 start 和竞态 |
| Prompt 组装 | Orchestrator | 统一上下文裁剪和模式选择 |

## 12. 对标项目技术映射

| 我们的模块 | 参考项目里的依据 | 采用方式 |
|---|---|---|
| Tauri + Rust 壳 | pluely-master | 作为主路线 |
| 透明灵动岛 | pluely-master/free-cluely | Tauri window + React UI |
| macOS NSPanel | pluely-master | P0 采用 |
| 内容保护 | free-cluely/pluely/natively | P0 采用，补诊断 |
| 深层 stealth | natively | 只借鉴公开稳定能力 |
| 系统音频 | pluely/natively | P0 采用 Rust native |
| 多 Provider 抽象 | natively/pluely | P0 只实现一个，结构预留 |
| 本地 Whisper | natively | P2，不进第一版 |
| Electron overlay | free-cluely/natively | 不作为主架构 |

## 13. 代码评审硬规则

后续写代码时按以下规则评审：

- UI 组件不能出现 API Key 明文。
- Provider 不能直接 emit UI event，必须经过 service。
- Command 不能包含业务编排。
- 系统 API 不能散落在业务 service 中。
- 截图链路必须使用隐藏 guard。
- 所有 Provider 错误必须映射成 `AppError`。
- 新增 Provider 必须实现统一 trait。
- 新增平台能力必须放到 `native/<capability>/<platform>.rs`。
- 任何日志都不能包含 Authorization header。
- stop/cancel/exit 必须清理后台任务。


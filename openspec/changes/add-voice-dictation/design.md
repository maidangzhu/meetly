# Design: add-voice-dictation

## 1. Architecture Decision

主参考采用 Handy 的协调器模式，而不是把完整流程写进一个 React hook：

```text
native shortcut input
  -> one active dictation run
  -> microphone recording
  -> STT
  -> optional AI polish
  -> native output
```

Meetly 第一版采用混合所有权：

- Rust 管理操作系统边界和当前 run lease：快捷键、目标焦点、剪贴板、粘贴、权限诊断、run id 校验。
- TypeScript 管理 WebView 中的录音和应用流程：`MediaRecorder`、STT 调用、AI 润色调用、悬浮岛反馈。
- Provider adapter 继续作为共享基础设施；Dictation 通过独立 application service 使用它们，不进入 Ask/Coach prompt。

选择该边界的原因：

- 当前 `src/useMicAsk.ts` 已经证明 WebView 麦克风录音和 `transcribe_audio` 可用，可以快速验证产品闭环；
- 全局快捷键、原焦点和粘贴属于 macOS 能力，不能由 React 可靠拥有；
- run id 让 Rust 和 TypeScript 能在不共享一个巨大状态对象的情况下拒绝过期异步结果；
- 后续把麦克风迁入 Rust 时，UI、STT、润色和输出契约无需重写。

## 2. Module Boundaries

新增前端模块：

```text
src/app/dictation/
  types.ts
  dictationReducer.ts
  useDictation.ts
  dictationPrompt.ts
```

职责：

- `types.ts`: run、状态、事件 payload 和设置类型。
- `dictationReducer.ts`: 纯状态转换和过期事件拒绝，可离线测试。
- `useDictation.ts`: 监听 Rust 快捷键事件，控制 `MediaRecorder`，依次调用 STT、润色和输出 commands。
- `dictationPrompt.ts`: 纯文本润色契约和默认提示词。

新增 Rust 模块：

```text
src-tauri/src/dictation/
  mod.rs
  state.rs
  shortcut.rs
  target.rs
  output.rs
  polish.rs
```

职责：

- `state.rs`: 单活 run、run id、快捷键 pressed 状态、目标 snapshot 和结束原因。
- `shortcut.rs`: macOS `keyDown`、`keyUp`、`flagsChanged` 监听、组合匹配、事件抑制和设置更新。
- `target.rs`: 记录触发时的前台 PID；Accessibility 可用时记录 focused element/window 的可恢复引用或等价标识。
- `output.rs`: 写剪贴板、验证/恢复目标、发送 layout-aware `Cmd + V`、处理恢复策略。
- `polish.rs`: 使用已保存 LLM credentials，返回普通字符串，不复用 `AssistantSuggestion`。
- `mod.rs`: Tauri commands/events、初始化和权限诊断。

现有文件只做窄接入：

- `src-tauri/src/lib.rs`: manage state、初始化 shortcut service、注册 commands。
- `src-tauri/Cargo.toml`: 增加必要的 macOS event/accessibility/clipboard 依赖。
- `src-tauri/capabilities/default.json`: 增加插件权限（若选择 Tauri clipboard plugin）。
- `src-tauri/Info.plist`: 麦克风说明覆盖 Ask 和用户主动语音输入。
- `src/SettingsApp.tsx`: Dictation 设置和权限诊断。
- `src/App.tsx`: 只接入紧凑状态展示。

以下模块不得承载 Dictation 业务：

- `src/app/useMicMeeting.ts`
- `src/useMicAsk.ts`
- `src/app/useAutoAssist.ts`
- Coach wake policy 和 PI observer

## 3. Native Shortcut Design

### 3.1 Why not only `tauri-plugin-global-shortcut`

普通组合键可以使用 Tauri global shortcut，但 `Fn` 在 macOS 上表现为 function modifier，并通过 `flagsChanged` 参与状态变化。可靠的 `Fn + Space` toggle 需要：

- 监听 `keyDown`、`keyUp` 和 `flagsChanged`；
- 识别 function modifier；
- 处理 key repeat；
- 在组合命中时抑制 Space，避免向输入框插入空格；
- event tap 被系统超时关闭后重置 pressed 状态并重新启用；
- 在 Accessibility 权限不足时提供普通组合键 fallback。

因此 shortcut service 提供两个 backend：

```text
native event tap: Fn、modifier-only、精确 press/release edge
standard global shortcut: Option+Space 等普通 fallback
```

首个默认配置：

```text
shortcut = Fn+Space
activationMode = toggle
fallbackShortcut = Option+Space
```

### 3.2 Shortcut Events

Rust 向 WebView 发出：

```ts
type DictationShortcutPressed = {
  runId: string;
  startedAt: number;
};

type DictationShortcutReleased = {
  runId: string;
  releasedAt: number;
};

type DictationBlocked = {
  reason: "meeting_active" | "permission_required" | "already_running";
};
```

按下时 Rust 必须先：

1. 拒绝活跃 meeting 或已有 dictation run；
2. 捕获目标应用/焦点；
3. 创建 run id；
4. 再发出 `dictation_shortcut_pressed`。

松开事件必须携带同一个 run id。前端只处理当前 run 的事件。

## 4. State Machine

前端状态：

```text
idle
  -> opening_microphone
  -> recording
  -> transcribing
  -> polishing
  -> pasting
  -> completed | copied

any active state -> cancelling -> idle
any stage -> error(stage, recoverableText?)
```

关键规则：

- 任意时刻只有一个 active run。
- 重复 key-down 和 key repeat 不创建新 run。
- 如果 key-up 早于 `getUserMedia` / `MediaRecorder.start()` 完成，记录 pending release；录音资源建立后立即安全停止。
- 低于最小录音时长的快速点击视为取消，不调用 STT。
- 所有异步结果都必须检查 run id；过期结果不能粘贴。
- Escape 使当前 run 进入 cancelling，并停止所有麦克风 track。
- STT 失败是终止错误，因为没有可恢复文本。
- AI 失败不是终止错误；使用 raw transcript 进入 pasting。
- paste 失败不是文本丢失；进入 copied 并保留最终文本。
- run 完成、取消或失败后，前后端都释放 lease 和媒体资源。

Rust `DictationState` 不复制前端每个显示状态，只保存操作系统一致性所需的信息：

```rust
struct ActiveDictationRun {
    id: String,
    shortcut_pressed: bool,
    started_at_ms: u64,
    target: TargetSnapshot,
}
```

## 5. Recording and STT

第一版从 `src/useMicAsk.ts` 提取可复用的低层录音 helper，但不共享 Ask 的业务状态：

```text
navigator.mediaDevices.getUserMedia({ audio: true })
  -> MediaRecorder (webm or ogg)
  -> complete Blob
  -> base64
  -> invoke("transcribe_audio")
```

约束：

- 不把片段加入 meeting transcript；
- 不调用 Ask completion；
- 不持久化完整 audio blob；
- stop/cancel 必须停止所有 MediaStreamTrack；
- run 完成后清空 chunks；
- 活跃 Meeting session 时不打开麦克风。

本 change 不增加 streaming STT。录音迁移到 Rust 和 VAD 属于后续 change。

## 6. AI Polish Contract

新增 Rust command：

```text
polish_dictation(run_id, raw_text) -> polished_text
```

它复用保存的 LLM endpoint、model 和 API key，但使用独立的普通文本 completion 方法。

系统提示要求：

- 保持原语言、含义、语气和人称；
- 删除“嗯、啊、就是”等无意义填充；
- 合并明显重复和 false start；
- 修正标点、语法和口述格式；
- 保留姓名、数字、URL、代码、产品名和专业术语；
- 不回答问题，不扩写观点，不增加事实；
- 只返回最终文本。

请求策略：

- 低 temperature；
- 非 streaming；
- 短超时；
- provider 支持时关闭 reasoning；
- 空响应、超时和网络失败统一回退 raw text；
- 日志记录字符数、耗时和 fallback reason，不记录 API key 或完整私人文本。

## 7. Target and Output

“找到输入框”定义为恢复快捷键按下时拥有焦点的目标，而不是扫描并猜测其他输入框。

输出流程：

```text
paste_dictation_text(run_id, text, clipboard_policy)
  -> validate active run id
  -> save current clipboard when restore policy is enabled
  -> write final text
  -> verify captured target process still exists
  -> restore/raise captured target only if focus changed
  -> send Cmd+V using current keyboard layout
  -> optionally restore previous clipboard after settle delay
```

失败策略：

- 没有 Accessibility 权限：只复制，返回 `copied`；
- target 已退出或失效：不向新前台应用粘贴，只复制；
- key injection 失败：只复制；
- clipboard 写入失败：返回 error；
- 自动粘贴成功后默认仍保留 dictation 文本；恢复旧剪贴板作为后续可选设置。

绝不自动发送 Enter。

## 8. Settings

最小设置：

```ts
type DictationSettings = {
  enabled: boolean;
  shortcut: string;
  fallbackShortcut: string;
  activationMode: "toggle";
  aiPolishEnabled: boolean;
  autoPasteEnabled: boolean;
  keepResultInClipboard: boolean;
};
```

设置写入本地应用配置；API key 继续使用已有 Keychain 路径。

Settings diagnostics 显示：

- microphone permission；
- Accessibility permission；
- shortcut registration status；
- fallback shortcut 是否生效；
- 固定文本 paste test。

## 9. UI

Dictation 不打开大面板，也不抢走当前应用焦点。

折叠岛只显示紧凑状态：

- recording：麦克风图标和音量反馈；
- transcribing：转写中；
- polishing：整理中；
- pasting：写入中；
- completed：短暂成功状态；
- copied：已复制，需要用户手动粘贴；
- blocked/error：一行可恢复原因。

状态在短延迟后回到 idle。Dictation 文本不加入 Meeting transcript panel。

## 10. Testing Strategy

### 10.1 Offline tests

- reducer/state-machine transitions；
- duplicate key-down；
- release-before-recorder-ready；
- stale run result rejection；
- cancel at every async stage；
- AI failure returns raw text；
- paste failure maps to copied；
- meeting-active block；
- settings migration/defaults。

### 10.2 Rust tests

- shortcut matcher for Fn+Space and fallback combinations；
- key repeat suppression；
- active run lease validation；
- stale run id rejection；
- output policy decision tests without real key injection；
- log redaction helpers。

### 10.3 Manual macOS acceptance

- TextEdit；
- Safari/Chrome textarea；
- 飞书 chat input；
- VS Code editor；
- Terminal；
- Accessibility denied；
- target app closed before completion；
- quick tap and Escape；
- built-in mic、AirPods、USB mic；
- active Feishu/Zoom meeting remains unaffected because Dictation is blocked。

## 11. Rollout

严格按 `tasks.md` 一个 Step 一个 Step 执行。每个 Step：

1. 只实现该 Step 的边界；
2. 运行该 Step 指定验证；
3. 更新 checkbox 和验证证据；
4. 停下来等待用户确认；
5. 未明确授权时不 commit、不 push。

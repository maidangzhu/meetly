# Meetly

Meetly 是一个 macOS 桌面悬浮面试辅助 MVP。当前目标不是做完整会议 SaaS，而是先把一个高频闭环跑顺：

```text
打开悬浮岛
  -> 点击开始，持续使用麦克风监听一场面试/对话
  -> 小段音频持续转写
  -> Enter 获取可直接说出口的建议
  -> 旁观者 agent 持续给短提示
  -> 结束后生成 Markdown 复盘报告
```

项目基于 `Tauri v2 + Rust + React/TypeScript`，定位是 local-first、BYOK、macOS first。

## 当前状态

已经跑通或已实现：

- 顶部居中的悬浮岛壳子，包含展开/收起、拖拽、设置入口。
- macOS `NSPanel` + `contentProtected` 隐藏模式。
- `Detectable / Undetectable` 状态切换；Undetectable 时外层显示虚线框。
- 展开面板：建议区、旁观者 agent、转写区。
- 麦克风开启面试监听：`getUserMedia -> MediaRecorder -> STT -> transcript`。
- VAD 小段切分，降低每次等待完整长录音的延迟。
- Enter 触发建议，录音不会中断。
- LLM 流式输出。
- PI runtime 侧边旁观者 agent，生命周期跟随当前会话。
- 会议/面试结束后生成 Markdown 复盘报告，保存到 `~/.meetly/reports/`。
- 设置页支持 STT/LLM Provider 的 base URL、model、API key。
- 本地调试日志写入文件，方便排查 STT/LLM/录音链路。

还没稳定或尚未完成：

- 系统音频采集仍是高风险项。CoreAudio Process Tap + 聚合设备代码存在，但紫色系统音频录制标识和 IOProc 数据流还需要继续验证。
- 当前主路径优先使用麦克风监听，系统音频不是默认可依赖路径。
- 截图/问屏幕还不是当前交互主线。
- 隐藏模式只能做 best-effort，不能承诺所有录屏、会议软件 100% 不可见。
- Provider 设置中的 API key 目前为本机开发体验写入 `~/.meetly/secrets.json`，权限 `0600`，不是正式版安全方案。

## 运行

环境要求：

- macOS
- Node.js + pnpm
- Rust toolchain
- Xcode Command Line Tools

安装依赖：

```bash
pnpm install
```

启动 Tauri 开发版：

```bash
pnpm tauri dev
```

前端构建检查：

```bash
pnpm build
```

Rust 检查：

```bash
cd src-tauri
cargo check
```

## 分发和测试版

当前仓库已经接入 GitHub Release + Tauri updater。发布产物包括：

- `Meetly_*.dmg`：给用户下载安装。
- `Meetly.app.tar.gz`：Tauri updater 使用。
- `Meetly.app.tar.gz.sig`：updater 签名。
- `latest.json`：updater 版本索引。

本机没有 Apple Developer ID 证书时，`pnpm tauri build` 只能产出 ad-hoc 签名包。这个包适合自己调试，或者给少量测试用户通过右键打开 / 移除 quarantine 的方式试用，但不能避免 Gatekeeper 的“取消 / 移到废纸篓”提示。

未 notarize 测试包安装后，如果 macOS 只显示“取消 / 移到废纸篓”，可以先确认自己信任这个本地测试包，然后执行：

```bash
xattr -dr com.apple.quarantine /Applications/Meetly.app
```

这条命令只是移除下载隔离标记，不等于正式签名或 notarize。只给内部测试用户使用；对外发布仍然要走 Apple Developer ID 签名和 notarization。

要产出别人双击即可正常打开的测试版或正式版，需要走 `.github/workflows/release-macos.yml`：

1. 在 GitHub Secrets 配置 Apple 和 Tauri updater 凭据。
2. 手动触发 `Release macOS` workflow，输入版本号。
3. CI 在 macOS runner 中签名 `.app`，notarize + staple `.dmg`，再上传 GitHub Release。

需要的 GitHub Secrets：

```text
APPLE_CERTIFICATE                  # base64 后的 Developer ID Application .p12
APPLE_CERTIFICATE_PASSWORD
KEYCHAIN_PASSWORD                  # CI 临时 keychain 密码
APPLE_ID                           # Apple ID 邮箱
APPLE_PASSWORD                     # Apple app-specific password
APPLE_TEAM_ID
TAURI_SIGNING_PRIVATE_KEY          # Tauri updater 私钥
TAURI_SIGNING_PRIVATE_KEY_PASSWORD # 当前可为空
```

Meetly 的 macOS entitlements 在 `src-tauri/Entitlements.plist`，当前声明麦克风输入和 WebView/JS runtime 所需的代码执行能力。权限说明文案在 `src-tauri/Info.plist`。

## Provider 配置

Meetly 当前使用 OpenAI-compatible 风格的 STT/LLM provider。

默认 STT：

```text
base_url: https://api.siliconflow.cn/v1/audio/transcriptions
model: FunAudioLLM/SenseVoiceSmall
```

默认 LLM：

```text
base_url: https://api.siliconflow.cn/v1/chat/completions
model: Qwen/Qwen3-32B
```

可以在设置页切换到其他 OpenAI-compatible 服务，例如 DeepSeek 兼容代理。API key 不会回传给前端读取，只用于请求时发给 provider。

开发环境也支持从环境变量 seed：

```text
STT_API_KEY
LLM_API_KEY
OPENAI_API_KEY
```

## 本地数据

当前本地文件主要在 `~/.meetly/`：

- `secrets.json`：开发期 API key 存储，`0600` 权限。
- `reports/`：每次会话结束后的 Markdown 复盘报告。
- debug log：用于排查录音、转写、LLM、agent 触发链路。

当前默认不做：

- 上传到 Meetly 自己的业务云端。
- 用户账号体系。
- 服务端扣点。
- 长期保存完整原始音频。

## 交互原则

当前产品先服务“面试辅助”：

- 点击左侧开始按钮后进入持续监听。
- 按 Enter 只是请求建议，不会停止录音。
- 不按 Enter 时，旁观者 agent 也可以基于转写上下文给短提示。
- 展开面板里建议和旁观者内容要始终可见，转写可以滚动。
- 大面板区域尽量允许点击穿透，避免共享屏幕时影响底层应用操作。
- Undetectable 状态通过虚线外框表达，而不是只依赖眼睛图标含义。

产品路线是：

```text
面试辅助
  -> 会议辅助
  -> 问屏幕 / 问上下文
  -> 带 memory 和工具调用的个人办公 agent
```

## 架构

代码分层：

```text
src/
  App.tsx
  app/                 # React hooks, state, session orchestration
  components/          # UI components
  runtime/             # PI observer runtime

src-tauri/src/
  app/                 # assistant/report service
  audio/               # mic/system audio, VAD, wav, transcript buffer
  domain/              # assistant domain types
  providers/           # STT/LLM config, storage, OpenAI-compatible clients
  window.rs            # NSPanel, positioning, stealth, click-through
  debug_log.rs
```

重要约束：

- React 负责 UI 和交互，不直接持久化 API key。
- Rust/Tauri command 负责 native capability 和 provider 调用。
- Provider 错误必须能落到用户可读提示和调试日志。
- 日志不能包含 Authorization header 或完整 API key。
- 前端单文件尽量保持在 500 行以内。

## 文档入口

- [PRD](./docs/PRD.md)
- [Product Roadmap](./docs/PRODUCT_ROADMAP.md)
- [Technical Design](./docs/TECHNICAL_DESIGN.md)
- [MVP Delivery Plan](./docs/MVP_DELIVERY_PLAN.md)
- [Floating Island Design](./docs/FLOATING_ISLAND_DESIGN.md)
- [Stealth and Screen Capture](./docs/STEALTH_AND_SCREEN_CAPTURE.md)
- [Reference Projects](./docs/REFERENCE_PROJECTS.md)

OpenSpec 变更记录在 `openspec/changes/`：

- `stabilize-interview-assist-p0`
- `add-interview-auto-assist-p1`
- `add-system-audio-transcription`
- `add-provider-settings`
- `add-llm-suggestions`

## 验收重点

每次改动至少确认：

- `pnpm build` 通过。
- `cargo check` 通过。
- 开始/结束麦克风监听没有回归。
- Enter 建议不会读取过期上下文。
- 展开/收起后窗口位置和尺寸不漂移。
- Detectable/Undetectable 外框不裁切、不遮内容。
- 大面板点击穿透不影响顶部交互。
- API key 不进入 git、日志、报告。

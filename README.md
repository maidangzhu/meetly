# Meetly

Meetly 是一个 macOS 悬浮 AI 助手。它把全局语音输入、实时对话辅助和主动式 AI 放在同一个桌面入口里。

[下载最新版本](https://github.com/maidangzhu/meetly/releases/latest) · [查看 Releases](https://github.com/maidangzhu/meetly/releases) · macOS Apple Silicon · Local-first · BYOK

```text
说一段话，直接写进当前输入框
按住 Fn，直接向 AI 口头提问
进入面试或会议，持续获得转写和临场建议
不主动提问时，AI 也能在关键节点提醒下一步
```

Meetly 不是单纯的录音转写工具，也不是悬浮在屏幕上的聊天框。它围绕三种不同的用户意图，提供三条彼此独立但共享上下文能力的工作流：

| 工作流 | 用户此刻需要什么 | Meetly 如何工作 |
|---|---|---|
| Voice Dictation | “把我说的话写出去” | 全局快捷键录音，转写、整理表达，并写回原来的输入框 |
| Voice Ask | “直接问 AI 一个问题” | 按住 `Fn` 说话，松开后转写并在独立悬浮窗显示回答 |
| Live Copilot | “帮我跟上这场面试或会议” | 持续监听和转写，结合最近对话、目标与资料生成临场建议 |
| Proactive Agent | “我没空提问，但别让我错过关键时刻” | 识别问题、风险和承诺等信号，在值得介入时主动给出短提示 |

交互上可以把它理解为：Typeless 式语音输入，加上 Granola / Cluely 式实时对话辅助，再加一层会主动判断何时介入的 AI runtime。

## 三条核心工作流

### 1. 全局语音输入

在任意可输入文字的 macOS 应用中：

```text
第一次按 Fn + Space
  -> 开始录音，屏幕底部显示实时音频波形

再次按 Fn + Space
  -> 停止录音
  -> 语音转文字
  -> AI 整理口语、标点和重复表达
  -> 粘贴回录音开始时的输入框

按 Esc
  -> 取消当前录音或处理，不写入任何内容
```

这是一套独立于会议监听和场边教练的流程。它不会把听写内容塞进会议 transcript，也不会自动发送消息。

当前行为：

- 默认快捷键是 `Fn + Space`，备用快捷键是 `Alt + Space`。
- 采用 toggle 交互，不需要持续按住快捷键。
- 处理阶段只显示 `Thinking...`，完成后显示已粘贴或已复制。
- AI polish 只整理用户说过的内容，不添加新观点；LLM 失败时回退到原始转写。
- 自动粘贴失败时保留剪贴板结果，不丢失已经完成的转写。
- 录音开始时记录目标应用，输出时尽量回到原输入框。
- 会议监听进行中时，语音输入暂不可用，避免两条音频链路互相干扰。
- 录音气泡会出现在鼠标当前所在显示器的底部；切换到外接屏幕后不再固定跟随主屏。

`Fn` 监听和自动粘贴依赖 macOS 辅助功能权限。未获得权限时，Meetly 会显示状态并尝试使用备用快捷键。

#### 按住 Fn 直接问 AI

单独按住 `Fn` 约 300ms 后，Meetly 会进入语音提问：

```text
按住 Fn
  -> 开始录音并显示音频波形

松开 Fn
  -> 转写刚才的问题
  -> Thinking...
  -> 在鼠标所在显示器底部展示回答浮窗
```

Voice Ask 使用通用回答模式，不会自动粘贴、不会提交输入框，也不会写入会议 transcript。`Fn + Space` 会优先识别为 Dictation，不会误触发 Voice Ask；按 `Esc` 可以取消录音、转写或思考过程。

### 2. 面试与会议实时辅助

Meetly 的悬浮岛可以持续监听一场真实对话，同时保持 Ask、主动提示和音频采集彼此独立。

开始会话前可以选择：

- `面试 / 我是面试者`：用第一人称组织回答，必要时参考简历和个人背景。
- `面试 / 我是面试官`：主动建议公平的追问、证据检查和评估角度，不设计刁难问题。
- `会议`：先写下这次会议想达成的目标，AI 会关注异议、承诺、价格、时间、范围、责任人与下一步。
- `身边 / 电话`：从麦克风听现场或手机扬声器里的对话。
- `电脑会议`：采集飞书、Zoom 等应用的系统音频，不占用会议麦克风。

会话中：

- VAD 将音频切成短段并持续转写，悬浮岛显示 partial / final transcript。
- 按 `Enter` 主动请求一次完整建议；Ask 不会停止或重启监听。
- 可以拖入 PDF、txt、Markdown、JSON、CSV 等资料，作为 Ask 和场边教练的明确上下文。
- LLM 输出采用流式展示，工具调用过程会显示为可见 trace。
- 会话结束后生成 Markdown 复盘，保存在 `~/.meetly/reports/`。

### 3. 主动式 AI

主动式 AI 不是定时刷一条“建议”，也不是每段转写都调用模型。当前 TS runtime 会先把 final transcript 写入短期上下文，再用确定性规则判断是否值得叫醒 Agent。

当前可以触发主动介入的信号包括：

- 对方提出了一个新问题；
- 用户出现“我不知道”“我想一下”等卡顿或弱回答信号；
- 对话提到了需要补充外部背景的公司、产品、市场或链接；
- 会议进入价格、预算、时间、交付、范围、责任、异议、让步、决策或下一步等关键节点；
- 会话刚开始，尤其是已经上传了简历或会议资料时。

Agent runtime 会处理优先级、串行队列、冷却时间、重复证据和在途合并，避免同一个问题反复提示。需要资料或外部信息时，它可以读取用户上传的文件或调用网页工具，并在界面中展示工具 trace。

三种输出的分工是明确的：

| 输出 | 谁触发 | 适合做什么 |
|---|---|---|
| Ask | 用户按 `Enter` | 给更完整、可以直接说出口的回答 |
| Proactive Coach | transcript 中出现关键事件 | 给一句下一步动作、开口语、纠偏或追问 |
| Transcript | 音频管线 | 记录现场事实，为 Ask 和 Agent 提供上下文 |

## 悬浮体验

- macOS 原生 `NSPanel`，常驻顶部、可拖拽、可展开和收起。
- 会话设置、实时转写、Ask、Coach、资料和设置都留在同一个紧凑悬浮入口中。
- `Detectable / Undetectable` 可切换；隐藏模式使用 `contentProtected` 等原生能力尽量减少被常见截图或录屏捕获。
- 展开和收起会保留用户拖动后的位置，不在每次 resize 时重新跳回顶部中央。
- 大面板尽量减少对底层应用操作的阻挡。

`Undetectable` 是 best-effort 能力，不承诺在所有 macOS 版本、会议软件和录屏工具中 100% 不可见。

## 快速开始

### 下载安装

从 [GitHub Releases](https://github.com/maidangzhu/meetly/releases/latest) 下载最新的 `Meetly_*_aarch64.dmg`，将 Meetly 拖入 Applications。

未使用 Developer ID 的测试包采用与 Percent `v0.1.8` 测试包相同的原始 Tauri 打包方式：只保留 linker ad-hoc 签名，不额外生成 hardened-runtime 的完整 app-bundle ad-hoc 签名。这样不会再生成当前 Meetly 公测包所使用的“完整 ad-hoc bundle 签名但未公证”组合。

测试包仍未经过 Apple notarization，macOS 可能显示“无法验证开发者”。如果确认包来自本仓库，但系统仍阻止打开，可以移除下载隔离标记：

```bash
xattr -dr com.apple.quarantine /Applications/Meetly.app
```

这只适用于你信任的测试包，不等于 Apple Developer ID 签名或公证。

### 首次配置

首次启动会打开设置页：

1. 配置一个 OpenAI-Whisper-compatible STT endpoint 与 API key。
2. 配置一个 OpenAI-compatible Chat Completions endpoint、模型与 API key。
3. 在 Diagnostics 中测试 STT、LLM、音频与自动粘贴。
4. 授予所需的 macOS 权限，然后进入顶部悬浮岛。

默认 provider 配置为：

```text
STT
base_url: https://api.siliconflow.cn/v1/audio/transcriptions
model: FunAudioLLM/SenseVoiceSmall

LLM
base_url: https://api.siliconflow.cn/v1/chat/completions
model: Qwen/Qwen3-32B
```

可以在设置页替换为其他兼容服务。API key 不会回传给前端读取。

### 权限说明

| 权限 | 用途 | 什么时候需要 |
|---|---|---|
| Microphone | 语音输入、身边对话或手机扬声器采集 | 使用 Dictation 或麦克风会话时 |
| Accessibility | 捕获 `Fn` 快捷键、恢复目标应用并自动粘贴 | 使用全局语音输入时 |
| Screen Recording / System Audio | 采集电脑会议声音 | 使用飞书、Zoom 等电脑会议模式时 |

## 当前边界

Meetly 目前仍是面向真实使用验证的 macOS alpha：

- 当前发布目标是 Apple Silicon macOS。
- 采用 BYOK；Meetly 不提供托管模型额度或用户账号系统。
- 系统音频使用 macOS CoreAudio Process Tap，具体权限提示和系统指示器受 macOS 版本影响。
- Dictation、Meeting/Interview 和 Ask 共用 provider 配置，但拥有独立状态机和音频生命周期。
- 当前不上传到 Meetly 自有业务云端，不做团队空间或跨设备同步。
- 默认不长期保存完整原始音频；会话 transcript 主要保存在当前运行时和生成的本地报告中。
- API key 当前保存在 `~/.meetly/secrets.json`，文件权限为 `0600`，尚未迁移到正式产品级 Keychain / Stronghold 方案。
- ad-hoc 测试包不包含完整的 signed updater 链；正式分发仍需要 Developer ID、notarization 和 Tauri updater 私钥。

## 技术架构

Meetly 基于 `Tauri v2 + Rust + React/TypeScript`。

```text
macOS audio / keyboard / focus / window
                  |
                  v
Rust native layer
  audio capture, VAD, STT, dictation target/paste,
  provider credentials, reports, NSPanel
                  |
          Tauri commands/events
                  |
                  v
React application layer
  floating UI, session state, dictation state machine,
  transcript presentation, Ask orchestration
                  |
                  v
TypeScript Agent runtime
  ContextStore -> DemandDetector -> Wake queue
  -> Prompt -> Transport -> Coach/tool traces
```

关键目录：

```text
src/
  app/dictation/          # Dictation 状态机与前端编排
  app/                    # 会话、Ask、转写和 React hooks
  runtime/agent/          # 主动式 AI 的上下文、检测、队列、提示词和 transport
  components/             # 悬浮岛、转写与 Coach 展示

src-tauri/src/
  audio/                  # 系统音频、VAD、音频片段和 transcript buffer
  dictation/              # 全局快捷键、目标捕获、AI polish、剪贴板与粘贴
  app/                    # Ask、资料解析与会后报告服务
  providers/              # STT / LLM 配置、凭据与兼容客户端
  window.rs               # NSPanel、位置、尺寸、隐藏与点击穿透
```

架构边界：

- React/TypeScript 负责用户意图、会话状态、Agent runtime 和 UI 展示。
- Rust 负责 native capability、音频/provider 服务和敏感凭据边界。
- Dictation 不复用 Meeting/Coach 状态；开始会话时由用户明确选择系统音频或麦克风，并分别管理生命周期。
- 普通 transcript 先进入上下文，只有命中 wake signal 才运行主动 Agent。
- Provider 错误必须进入用户可读状态与本地日志；日志不能包含完整 API key 或 Authorization header。

## 本地开发

环境要求：

- macOS
- Node.js + pnpm
- Rust toolchain
- Xcode Command Line Tools

```bash
pnpm install
pnpm tauri dev
```

常用验证命令：

```bash
pnpm build
pnpm test:dictation
pnpm test:wake
cargo fmt --check --manifest-path src-tauri/Cargo.toml
cargo test --lib --manifest-path src-tauri/Cargo.toml
cargo check --manifest-path src-tauri/Cargo.toml
```

本地文件：

```text
~/.meetly/secrets.json   # STT / LLM API keys，0600
~/.meetly/reports/       # 会话结束后的 Markdown 报告
~/.meetly/debug.log      # 音频、STT、LLM、Agent 调试日志
```

## 打包与发布

```bash
pnpm package:macos:test
```

这个命令会在 CI 模式下跳过易受 Finder 当前窗口影响的 DMG 美化步骤，使用 `--no-sign` 直接生成 DMG，并自动验证产物与 Percent 包一致：只有 linker 签名，没有 hardened runtime、sealed resources 或完整 `_CodeSignature`。测试配置同时关闭 updater artifacts，因此不需要 Tauri updater 私钥。

没有 Apple Developer ID 时，这个 DMG 只适合内部测试。完整发布流程仍在 [`.github/workflows/release-macos.yml`](./.github/workflows/release-macos.yml)，并继续使用正式 entitlements、Developer ID、notarization 和 updater 签名，需要：

- Developer ID Application 证书；
- Apple notarization 凭据；
- Tauri updater private key。

完整签名流程会生成 DMG、`.app.tar.gz`、`.sig` 和 `latest.json`。不要把旧版本遗留的 updater 文件混入新 Release。

## 设计与研究文档

- [Voice Dictation Research](./docs/VOICE_DICTATION_RESEARCH.md)
- [Product Roadmap](./docs/PRODUCT_ROADMAP.md)
- [Technical Design](./docs/TECHNICAL_DESIGN.md)
- [Floating Island Design](./docs/FLOATING_ISLAND_DESIGN.md)
- [Agent Wake Strategy](./docs/AGENT_WAKE_STRATEGY.md)
- [Stealth and Screen Capture](./docs/STEALTH_AND_SCREEN_CAPTURE.md)
- [Reference Projects](./docs/REFERENCE_PROJECTS.md)
- [Voice Dictation OpenSpec](./openspec/changes/add-voice-dictation/)

部分设计文档记录了早期方案与架构演进；当前行为以源码和已通过验证的 OpenSpec 为准。

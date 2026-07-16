# Proposal: add-voice-dictation

> Historical MVP baseline. The implemented mixed React/Rust runtime is being
> followed by `stabilize-voice-dictation-runtime`, which defines a Rust-owned
> coordinator and first-class ASR/LLM provider contracts. Keep this proposal as
> the record of the first vertical slice.

## Why

Meetly 当前的核心能力围绕会议会话展开：Rust 捕获系统音频，Ask 单独录制一次麦克风片段，Coach 根据会议上下文提供建议。

随着产品向个人办公助手扩展，用户还需要一种不依赖会议会话的轻量入口：在任意应用中按住快捷键说话，松开后得到经过 AI 整理的文本，并回填到原输入位置。

当前项目已经具备浏览器麦克风录制、一次性 STT、OpenAI-compatible LLM 配置和非激活悬浮岛，但缺少：

- 可配置的 macOS 全局按下/松开快捷键；
- 与 Ask/Coach/Meeting 隔离的 Dictation 状态机；
- 面向口述文本的纯文本 AI 润色契约；
- 剪贴板、原焦点恢复和自动粘贴；
- STT 成功后 AI 或粘贴失败时的可恢复降级。

参考实现选择 [Handy](https://github.com/cjpais/Handy) 作为主架构样本。它与 Meetly 同为 Tauri + Rust + React，使用 MIT 许可，并把快捷键、转录协调、可选后处理和剪贴板输出组织为完整闭环。macOS `Fn` 事件的具体监听语义参考 VoiceInk 的 `CGEvent` / `flagsChanged` 方案，但不复制其受单独许可证约束的源码。

## What

- 新增独立的 `Dictation` 工作流，不复用 Meeting、Ask 或 Coach 的会话状态。
- 新增 macOS 原生快捷键服务：
  - 默认支持 `Fn + Space`；
  - 支持用户配置其他组合；
  - 采用 Typeless 风格 toggle：第一次按下开始，第二次按下转写；
  - Escape 取消当前录音或处理；
  - 快捷键触发时记录目标前台应用和焦点上下文。
- 第一版复用 `MediaRecorder` 录制麦克风和现有 `transcribe_audio` STT command。
- 新增 Dictation 专用的纯文本 AI 润色服务：
  - 保留用户语言和意图；
  - 删除口头填充、重复和明显口误；
  - 修正标点和语法；
  - 不补充用户没有说过的事实；
  - 只返回最终文本。
- 新增 macOS 输出服务：
  - 写入系统剪贴板；
  - 尽量恢复快捷键触发时的原应用和输入焦点；
  - 模拟 `Cmd + V`；
  - 自动粘贴失败时把最终文本保留在剪贴板。
- 新增独立的 Dictation 状态和悬浮岛反馈：`recording`、`transcribing`、`polishing`、`pasting`、`copied`、`error`。
- 新增取消、重复事件抑制、快速松键和异步阶段竞争处理。
- 新增设置项：快捷键、AI 润色、自动粘贴、保留剪贴板文本。
- 新增离线状态机测试和 macOS 输出服务的可验证 spike。

## Non-goals

- 不把 Dictation 文本写入会议 transcript，也不触发 Ask、Coach、prefetch 或会议报告。
- 第一版不允许 Dictation 与活跃 Meeting session 并发；需要真实飞书/Zoom/耳机测试通过后再放开。
- 第一版不把麦克风录制迁移到 Rust；先复用已经验证可工作的 `MediaRecorder` 路径。
- 不做实时/流式 STT；松开快捷键后提交完整音频片段。
- 不做本地 Whisper、Parakeet 或模型下载器。
- 不读取屏幕、完整输入框内容、邮件或聊天上下文来决定语气。
- 不主动寻找另一个输入框；只回到快捷键触发时的目标。
- 不自动按 Enter，不发送消息，不提交表单。
- 不增加 Windows/Linux 兼容实现。
- 不默认持久化完整音频。

## Success Criteria

- 在 TextEdit、Safari/Chrome、飞书、VS Code 和 Terminal 中，快捷键触发时的原输入位置可以稳定收到文本。
- toggle 的重复按键、键盘重复和取消不会产生重叠录音或重复粘贴。
- 短语音停止后能完成 `STT -> AI 润色 -> 粘贴`；云端 MVP 目标是最终文本就绪后 250ms 内完成剪贴板写入和粘贴。
- AI 超时、配置错误或返回空文本时，系统使用原始 STT 文本继续输出。
- 自动粘贴失败或缺少 Accessibility 权限时，最终文本仍留在剪贴板并显示 `copied` 状态。
- Dictation 运行不会调用 `start_listening`、修改会议 transcript 或触发 Coach。
- 活跃 Meeting session 中触发 Dictation 时，系统拒绝开始并显示不打断会议的短提示。

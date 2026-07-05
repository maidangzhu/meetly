# MVP Delivery Plan

## 1. 交付原则

第一版先验证一个面试辅助闭环：

> 悬浮灵动岛通过麦克风持续听到面试/高压问答内容，转成文字，用户一键拿到可以直接说出口的建议。

后续再扩展到会议记录、问屏幕、memory 和个人办公 agent。路线见 [PRODUCT_ROADMAP.md](./PRODUCT_ROADMAP.md)。

所有不能服务这个闭环的功能都延后。

## 2. 里程碑

### M0: 工程骨架

目标：

- 初始化 Tauri v2 + React + TypeScript。
- 配置 Rust workspace。
- 建立 lint/format/build。
- 建立 docs 与测试目录。

验收：

- `pnpm tauri dev` 能启动。
- 空灵动岛窗口出现。
- 设置窗口能打开。

### M1: 原生灵动岛窗口

目标：

- 透明、无边框、顶部居中。
- 收起 `600 x 54`。
- 展开 `600 x 420/600`。
- 不抢焦点。
- 全局快捷键可控制。
- macOS NSPanel。

验收：

- 可以跨应用停留。
- 可以展开/收起。
- 不出现在 Dock/任务栏。
- 快捷键冲突可提示。

### M2: 音频状态闭环

目标：

- 检测当前平台。
- 检测默认输入/输出音频设备。
- `start_listening()` / `stop_listening()` 接入 Rust 状态。
- UI 从前端假状态切到 Rust 返回的真实 listening/setup/error 状态。
- 诊断面板显示音频设备与状态。

验收：

- 点击监听按钮后状态来自 Rust command。
- 没有可用设备时显示 `Setup needed`。
- 重复 start/stop 不会造成状态错乱。
- 该阶段不要求真实 PCM 捕获，不接 STT。

### M3: 系统音频捕获

目标：

- macOS Core Audio 系统音频捕获。
- 统一 PCM 输出。
- 音量状态显示。
- 捕获失败可恢复。

验收：

- 播放会议音频时 UI 有音量变化。
- 静音时不发送音频。
- 连续 30 分钟不崩溃。

### M4: 隐藏与截图

目标：

- `contentProtected`。
- macOS sharing type / panel 设置。
- 截图前隐藏，截图后恢复。
- 设置页隐藏测试。

验收：

- 内部截图 20 次不包含灵动岛。
- 诊断页能显示各保护项是否成功。

### M5: STT 实时转写

目标：

- 阿里云实时 STT WebSocket。
- VAD 分段。
- partial/final 事件。
- 转写 ticker 和展开列表。

验收：

- 中文会议音频能实时出字。
- STT 断线能提示并重连。
- API Key 错误能诊断。

### M6: LLM 建议

目标：

- OpenAI-compatible LLM adapter。
- Ask/Enter 快捷键。
- 面试/会议模式 prompt。
- 简短结构化建议。

验收：

- 监听已经开启时，Ask/Enter 基于最近转写生成回答。
- Ask/Enter 不停止、不暂停、不重启系统音频采集或 STT。
- Ask 失败或超时时，转写继续进入最近上下文，用户可以重试。
- 首 token 小于 4 秒为目标。
- 超时可重试。

### M7: 截图分析

目标：

- 截图 + 最近转写输入 vision LLM。
- 返回屏幕相关建议。
- 不支持 vision 时给明确提示。

验收：

- 题目截图能生成回答结构。
- 截图不包含灵动岛。

### M8: 打包与可测版本

目标：

- macOS 可安装包。
- 日志和诊断足够定位问题。

验收：

- 非开发环境可启动。
- 首次配置可跑通。
- 真实会议场景可试用 30 分钟。

## 3. 第一版页面清单

- 灵动岛收起态。
- 灵动岛展开态。
- 设置窗口。
- 诊断窗口/诊断区域。
- 错误提示轻量 toast。

## 4. 第一版接口清单

Tauri commands：

- `start_listening()`
- `stop_listening()`
- `ask_assistant(mode, user_note?)`
- `capture_and_ask(mode, user_note?)`
- `set_island_height(height)`
- `set_island_visible(visible)`
- `open_settings()`
- `save_provider_config(config)`
- `test_stt_config(config)`
- `test_llm_config(config)`
- `run_stealth_test()`
- `register_shortcut(action, shortcut)`

Tauri events：

- `audio_level_changed`
- `transcript_partial`
- `transcript_final`
- `assistant_delta`
- `assistant_done`
- `assistant_error`
- `stealth_status_changed`
- `permission_error`

## 5. UI 状态机

```text
idle
  -> listening
  -> thinking
  -> showing_answer
  -> error

listening
  -> paused
  -> thinking
  -> error

thinking
  -> showing_answer
  -> error
```

状态展示：

- idle: 灰色状态点。
- listening: 绿色状态点 + 最新转写。
- thinking: 进度 shimmer/小 spinner。
- error: 红色状态点 + 可点击诊断。
- paused: 黄色状态点。

## 6. 设计验收

- 第一版交互和样式以 Pluely 为明确对标，不另起 dashboard 型主界面。
- 默认窗口必须是顶部居中的 `600 x 54` 横向灵动岛。
- 主体必须是一张紧凑 Card：轻透明、轻边框、轻阴影、圆角约 `12px`。
- 左侧音频入口，中间 Ask/转写/音频可视化，右侧截图/状态/拖拽。
- 图标按钮约 `36 x 36`，icon 约 `16 x 16`。
- 展开态通过下方 popover/panel 呈现，高度切到 `600`。
- 收起态高度固定，不因文本变化抖动。
- 最长中文句子不能撑破灵动岛。
- 所有图标按钮有 tooltip。
- 展开态不能出现卡片套卡片。
- 错误提示不遮挡主要建议。
- 深色/浅色背景下透明窗口边界都可读。
- 不使用夸张渐变和营销布局。

## 7. 技术验收

- macOS 构建通过。
- Rust 音频任务停止后无残留线程。
- WebSocket 断线可重连。
- API Key 不进入日志。
- 内部截图不包含灵动岛。
- 连续监听 30 分钟内存无明显增长。

## 8. 风险与应对

| 风险 | 影响 | 应对 |
|---|---|---|
| macOS 系统音频权限/实现复杂 | 阻塞实时转写 | 优先复用 Pluely 的 CoreAudio 方案，必要时先接 BlackHole/虚拟设备作为开发 fallback |
| 录屏保护不稳定 | 用户预期风险 | 明确 best-effort，设置页提供测试 |
| STT 延迟高 | 临场体验差 | VAD 小片段、实时 WebSocket、只发有效语音 |
| LLM 返回太长 | 用户读不过来 | 强 schema 和短输出限制 |
| 快捷键冲突 | 无法操作 | 设置页可改 + 注册失败提示 |
| Provider 欠费/限流 | 体验中断 | 诊断页原样展示错误码 |

## 9. P0 / P1 / P2

### P0

- macOS 灵动岛。
- 隐藏模式。
- 系统音频持续监听。
- 阿里云 STT。
- 手动触发 LLM 建议：用户按 Ask/Enter 时读取滚动 transcript，生成“现在该怎么回应”。
- 截图分析。
- 设置和诊断。
- 不做自动抢答，不做自动弹大答案。

### P1

- 腾讯云 STT adapter。
- 保存会议记录。
- mic + system 双通道。
- 更好的 VAD。
- 自动会议摘要：每累计若干条 final transcript 或每隔固定时间刷新一次摘要/关键点/建议问题。
- 轻量自动提示：检测到明显问题句时只显示 `Press Enter for help` 级别的低干扰提示。

### P2

- 本地 Whisper。
- 说话人分离。
- RAG。
- 日历/会议软件集成。
- 团队版。
- 可选 auto assist：基于置信度、冷却时间和 planner 的自动建议，但默认关闭。

## 10. 会议辅助交互分层

### P0: 持续转写，手动协助

会议开始后，`start_listening()` 进入持续监听状态。系统音频、VAD、STT 和 transcript buffer 持续运行，直到用户显式停止监听或退出会议。

Ask/Enter 是独立的协助触发器：

- 读取最近 90-180 秒 transcript。
- 调用 LLM 生成短建议。
- 不影响音频采集任务。
- 不清空 transcript buffer。
- 不要求用户重新录制问题。

P0 的体验目标是稳定、可控、低打扰：用户决定什么时候让 AI 出声。

### P1: 自动摘要和轻提示

在不打断会议的前提下，后台可以基于 transcript 自动刷新辅助信息：

- 每 5 条 final transcript 或每 60 秒刷新会议摘要。
- 展示关键点、可能的后续问题、下一步行动。
- 如果检测到明确问题句，只在灵动岛上显示轻提示，例如 `Question detected · Press Enter`。

P1 不自动展开完整答案。

### P2: 可选自动协助

成熟后再考虑默认关闭的 auto assist：

- 只在高置信度问题句上触发。
- 必须有冷却时间，避免连续刷屏。
- planner 可以选择 `silent`、`clarify`、`recap`、`follow_up_questions` 或 `answer`。
- 自动生成的内容要能被用户一键忽略或收起。

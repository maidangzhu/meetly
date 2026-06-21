# MVP Delivery Plan

## 1. 交付原则

第一版只验证一个闭环：

> 悬浮灵动岛听到会议内容，转成文字，用户一键拿到可以直接说出口的建议，并且自己的截图链路不会把灵动岛截进去。

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

### M2: 隐藏与截图

目标：

- `contentProtected`。
- macOS sharing type / panel 设置。
- Windows display affinity 封装。
- 截图前隐藏，截图后恢复。
- 设置页隐藏测试。

验收：

- 内部截图 20 次不包含灵动岛。
- 诊断页能显示各保护项是否成功。

### M3: 系统音频捕获

目标：

- macOS Core Audio 系统音频捕获。
- Windows WASAPI loopback 预留或实现。
- 统一 PCM 输出。
- 音量状态显示。
- 捕获失败可恢复。

验收：

- 播放会议音频时 UI 有音量变化。
- 静音时不发送音频。
- 连续 30 分钟不崩溃。

### M4: STT 实时转写

目标：

- 阿里云实时 STT WebSocket。
- VAD 分段。
- partial/final 事件。
- 转写 ticker 和展开列表。

验收：

- 中文会议音频能实时出字。
- STT 断线能提示并重连。
- API Key 错误能诊断。

### M5: LLM 建议

目标：

- OpenAI-compatible LLM adapter。
- Ask 快捷键。
- 面试/会议模式 prompt。
- 简短结构化建议。

验收：

- Ask 基于最近转写生成回答。
- 首 token 小于 4 秒为目标。
- 超时可重试。

### M6: 截图分析

目标：

- 截图 + 最近转写输入 vision LLM。
- 返回屏幕相关建议。
- 不支持 vision 时给明确提示。

验收：

- 题目截图能生成回答结构。
- 截图不包含灵动岛。

### M7: 打包与可测版本

目标：

- macOS 可安装包。
- Windows 可运行包可选。
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
- 系统音频。
- 阿里云 STT。
- LLM 建议。
- 截图分析。
- 设置和诊断。

### P1

- Windows WASAPI + display affinity。
- 腾讯云 STT adapter。
- 保存会议记录。
- mic + system 双通道。
- 更好的 VAD。

### P2

- 本地 Whisper。
- 说话人分离。
- RAG。
- 日历/会议软件集成。
- 团队版。

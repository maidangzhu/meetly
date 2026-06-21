# fuck-stupid-interview

一个面向中文会议、面试、销售沟通场景的极简桌面辅助 MVP。

这个 README 是项目总规范。后续写代码、拆任务、做验收，先以这里为准；更详细的方案放在 `docs/`。

## 1. 产品定位

第一版只验证一个闭环：

```text
顶部悬浮灵动岛
  -> 监听会议系统音频
  -> 实时中文转写
  -> 用户一键 Ask
  -> 给出可以直接说出口的短建议
  -> 截图分析时自动隐藏灵动岛
```

第一版不是：

- 会议知识库。
- 团队协作 SaaS。
- 自动代替用户开会的机器人。
- 本地 Whisper 安装器。
- 反检测/绕过工具。
- 大而全 dashboard。

## 2. 第一版硬决策

- 客户端：`Tauri v2 + Rust + React/TypeScript`。
- 架构：local-first desktop app。
- 账号：P0 不登录、不注册、不扣点。
- 模型接入：P0 纯 BYOK。
- 云端：P0 没有我们的业务云端。
- 首发平台：macOS 优先，Windows 跟进，Linux 不做 P0 承诺。
- 音频：P0 优先采集系统音频，不做 mic + system 双通道。
- STT：P0 选国内云端实时 STT，优先阿里云百炼/Model Studio 实时语音识别。
- LLM：P0 使用 OpenAI-compatible Provider，用户填 base URL、model、API Key。
- 本地 Whisper：P2，不进第一版。
- 隐藏：P0 必须做，但只能承诺 best-effort，不承诺所有录屏软件 100% 不可见。

## 3. BYOK 和数据边界

P0 采用 BYOK，即用户使用自己的 STT/LLM API Key。

调用路径：

```text
用户电脑
  -> Rust Provider Client
  -> 用户自己的 STT Provider
  -> 用户自己的 LLM Provider
```

本地安全存储：

- STT API Key。
- LLM API Key。
- Secret Key。

本地普通存储：

- Provider 类型。
- Base URL。
- Model 名称。
- 快捷键。
- 窗口位置。
- UI 偏好。
- 隐藏模式开关。

默认不存：

- 完整音频。
- 完整截图。
- 完整会议记录。

P0 云端不存：

- 用户账号。
- API Key。
- 音频。
- 截图。
- 转写历史。
- 用量/扣点。

## 4. 交互和样式基准

第一版交互和样式明确对标 Pluely。

必须满足：

- 顶部居中。
- 默认窗口 `600 x 54`。
- 展开窗口高度 `600`。
- 透明、无边框、always-on-top。
- 主 UI 是一张横向紧凑 Card。
- 左侧：系统音频入口。
- 中间：Ask 输入、转写 ticker 或音频可视化。
- 右侧：截图、状态、拖拽手柄。
- 图标按钮约 `36 x 36`。
- icon 约 `16 x 16`。
- Popover/panel 从灵动岛下方展开。
- 收起态不能因为文本变化抖动。
- 不做 landing page、hero、营销式大页面、卡片套卡片。

悬浮窗口技术路线：

```text
Tauri WebviewWindow
  -> transparent + frameless + always-on-top
  -> macOS NSPanel enhancement
  -> Windows display affinity enhancement
  -> React Pluely-style island UI
```

## 5. 隐藏和录屏保护口径

隐藏必须做，但产品和技术口径必须准确。

可以承诺：

- 本应用自己的截图链路必须不包含灵动岛。
- 截图分析前自动隐藏灵动岛，截图后恢复。
- 使用系统能力尽量避免常见截图/录屏捕获灵动岛。
- 设置页提供隐藏诊断。

不能承诺：

- 100% 隐身。
- 所有录屏软件都看不到。
- 所有会议软件共享屏幕都不会显示。

P0 技术组合：

- Tauri `contentProtected`。
- macOS `NSWindow.sharingType = .none`。
- macOS `NSPanel`。
- Windows `SetWindowDisplayAffinity(WDA_EXCLUDEFROMCAPTURE)`。
- 内部截图前主动 hide window。

产品文案必须使用：

```text
隐藏模式会尽量避免悬浮窗出现在常见截图和录屏中。不同系统版本和录屏软件行为不同，无法保证所有场景都不可见。
```

## 6. 架构分层

工程分四层：

```text
Presentation Layer
  -> Application Layer
  -> Native Capability Layer
  -> Provider / Infrastructure Layer
```

规则：

- React 只负责 UI 和交互。
- React 不直接调用 STT/LLM。
- React 不持有 API Key 明文。
- Tauri command 只做参数校验和调用 service。
- Service 负责业务编排。
- Native layer 负责窗口、音频、截图、隐藏、快捷键。
- Provider layer 负责 STT/LLM 适配。
- Storage layer 负责本地配置和安全存储。

推荐模块：

```text
src-tauri/src/
  commands/
  app/
  native/
  providers/
  storage/
  domain/
```

关键设计模式：

- Provider Adapter。
- Platform Strategy。
- Service Layer。
- Command Handler。
- Event-driven UI。
- State Machine。
- Repository。
- RAII Guard。
- Prompt Orchestrator。

## 7. 开发节奏

不要一次性把所有功能做完。

采用小版本、小闭环推进：

```text
0.1 工程骨架 + 空灵动岛
0.2 Pluely-style 悬浮窗 + 展开收起 + 拖拽
0.3 隐藏模式 + 截图前隐藏 + 隐藏诊断
0.4 Mock audio + Mock STT + Mock LLM
0.5 系统音频捕获 + 音量可视化
0.6 阿里云 STT + 实时转写
0.7 Ask LLM + 回答建议
0.8 截图分析 + Vision LLM
0.9 BYOK 设置 + 安全存储 + 打包准备
1.0 第一个可试用 MVP
```

每个版本都必须：

- 能启动。
- 能手动验证。
- 不破坏上一版能力。
- 有明确验收项。
- 发现风险后及时回写文档。

## 8. OpenSpec 工作流

采用规格驱动开发思路。

目录建议：

```text
openspec/
  project.md
  specs/
    floating-island/spec.md
    stealth-capture/spec.md
    system-audio/spec.md
    stt-provider/spec.md
    llm-assistant/spec.md
    byok-settings/spec.md
  changes/
    add-floating-island-shell/
      proposal.md
      design.md
      tasks.md
      specs/floating-island/spec.md
```

规则：

- `specs/` 表示当前系统事实。
- `changes/` 表示准备实现的变更。
- 一个 change 只解决一个明确小闭环。
- 开工前先写 proposal/design/tasks。
- 实现时按 tasks 推进。
- 验证通过后 archive，并更新主 specs。

不要用“把 MVP 做完”作为任务名。任务必须像：

```text
add-tauri-shell
add-floating-island-window
add-pluely-style-toolbar
add-island-expand-collapse
add-stealth-capture-guard
add-mock-audio-provider
add-aliyun-stt-provider
add-assistant-ask-flow
add-byok-settings-storage
```

## 9. Definition of Done

每个功能做完必须满足：

- 代码实现完成。
- UI 状态完整。
- loading/empty/error/disabled 状态完整。
- 关键错误有用户可读提示。
- 日志不泄露 API Key。
- 前端不持有 API Key 明文。
- Provider 错误码能进入诊断。
- 本地手动测试通过。
- 相关文档/spec 更新。
- 没有破坏已有功能。

系统能力功能还必须满足：

- macOS 真机测试。
- 截图不包含灵动岛。
- 失败后窗口能恢复。
- 后台任务可取消。
- App 退出能清理音频流/WebSocket。

## 10. 高风险项优先验证

先做 spike，不要等 UI 全做完才验证。

最高风险：

- macOS 系统音频捕获。
- macOS NSPanel + content protection。
- 截图前隐藏稳定性。
- 阿里云实时 STT 延迟。
- 多 Space/全屏会议窗口下悬浮行为。
- 权限流程。
- Provider mock 和状态机。

这些没跑通之前，不要大规模堆设置页、历史记录、复杂 dashboard。

## 11. 测试要求

P0 至少要有：

- Rust 单元测试。
- Provider mock 测试。
- Tauri command 集成验证。
- UI 组件基础测试。
- Playwright 截图检查。
- macOS 真机手动测试。
- 隐藏/录屏测试矩阵。
- 30 分钟连续监听稳定性测试。

悬浮窗回归测试：

- 连续展开/收起 50 次不尺寸错乱。
- 拖拽后位置可保存。
- 输入框可正常 focus。
- 按钮点击不被 drag region 吃掉。
- 文本超长不撑破工具条。
- 截图失败也能恢复窗口。

## 12. 代码评审硬规则

- UI 组件不能出现 API Key 明文。
- Provider 不能直接 emit UI event，必须经过 service。
- Command 不能包含复杂业务编排。
- 系统 API 不能散落在业务 service 中。
- 截图链路必须使用隐藏 guard。
- 所有 Provider 错误必须映射成统一 `AppError`。
- 新增 Provider 必须实现统一 trait。
- 新增平台能力必须放到 `native/<capability>/<platform>.rs`。
- 日志不能包含 Authorization header。
- stop/cancel/exit 必须清理后台任务。

## 13. 文档入口

- [PRD.md](./docs/PRD.md)
- [TECHNICAL_DESIGN.md](./docs/TECHNICAL_DESIGN.md)
- [ARCHITECTURE_PATTERNS.md](./docs/ARCHITECTURE_PATTERNS.md)
- [FLOATING_ISLAND_DESIGN.md](./docs/FLOATING_ISLAND_DESIGN.md)
- [PLUELY_STYLE_SPEC.md](./docs/PLUELY_STYLE_SPEC.md)
- [STEALTH_AND_SCREEN_CAPTURE.md](./docs/STEALTH_AND_SCREEN_CAPTURE.md)
- [STT_PROVIDERS.md](./docs/STT_PROVIDERS.md)
- [MVP_DELIVERY_PLAN.md](./docs/MVP_DELIVERY_PLAN.md)
- [REFERENCE_PROJECTS.md](./docs/REFERENCE_PROJECTS.md)

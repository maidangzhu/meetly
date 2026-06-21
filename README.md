# fuck-stupid-interview

一个面向中文会议、面试、销售沟通场景的极简桌面辅助 MVP。

当前阶段只落产品和技术文档，不先写代码。第一版方向已经收敛为：

- 客户端：Tauri v2 + Rust + React/TypeScript
- 核心形态：原生透明悬浮灵动岛
- 首发平台：macOS 优先，Windows 跟进，Linux 暂不作为首发承诺
- 音频：优先采集系统音频
- 识别：优先接国内云端实时 STT，不把本地 Whisper 放进 P0
- 隐藏：第一版必须做，但明确是 best-effort，不承诺对所有录屏软件 100% 不可见

文档入口：

- [PRD.md](./docs/PRD.md)
- [TECHNICAL_DESIGN.md](./docs/TECHNICAL_DESIGN.md)
- [STT_PROVIDERS.md](./docs/STT_PROVIDERS.md)
- [STEALTH_AND_SCREEN_CAPTURE.md](./docs/STEALTH_AND_SCREEN_CAPTURE.md)
- [MVP_DELIVERY_PLAN.md](./docs/MVP_DELIVERY_PLAN.md)
- [REFERENCE_PROJECTS.md](./docs/REFERENCE_PROJECTS.md)

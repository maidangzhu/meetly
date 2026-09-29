# 防截屏

听会时的悬浮窗可以打开防截屏。开关走 `set_stealth`，在 macOS 上对应 `NSWindow.sharingType = .none`（Tauri `contentProtected`）。这会降低窗口被一部分截图和窗口捕获录到的概率，但不是绝对隐身。

## 窗口

悬浮窗是透明无边框窗口，在 macOS 上做成 `NSPanel`：

- `nonactivatingPanel`，不抢正在开会的应用焦点。
- floating level，停在上层。
- `canJoinAllSpaces` 和 `fullScreenAuxiliary`，尽量跟着 Space 和全屏会议。

设置窗口是单独的普通窗口，不跟悬浮术语卡叠在一起。

## 能力边界

`sharingType.none` 主要影响基于窗口列表的捕获，例如 `CGWindowListCreateImage` 和一部分传统录屏。ScreenCaptureKit 从合成器帧缓冲读取，不一定尊重这个标记。较新的 Zoom、Teams、Loom 可能仍能录到窗口。

因此产品文案只说：隐藏模式会尽量避免悬浮窗出现在常见截图和录屏中。不要写“完全不会被录到”“100% 隐身”或“任何会议软件都看不到”。不同系统版本和录屏软件的结果不一样。

当前范围只有 macOS。不使用私有 API 去加强隐藏。

## 已测记录

| 工具 | 悬浮窗是否可见 | 备注 |
|---|---|---|
| 飞书会议录制 | 否 | 2026-07-04，`set_stealth` 生效 |
| 微信截图 | 否 | 2026-07-04，`set_stealth` 生效 |

系统截图、QuickTime、Zoom、腾讯会议、OBS 没有作为当前承诺写进产品。需要时在目标软件里手动看一眼。

官方说明：

- [NSWindow.SharingType.none](https://developer.apple.com/documentation/appkit/nswindow/sharingtype-swift.enum/none)
- [ScreenCaptureKit](https://developer.apple.com/documentation/screencapturekit/)
- [Tauri window content protection](https://v2.tauri.app/reference/config/)

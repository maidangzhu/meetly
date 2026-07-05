# Stealth And Screen Capture

## 1. 结论

第一版必须实现隐藏，但必须把“隐藏”拆成三个层级：

1. 本应用自己的截图链路：必须 100% 不截到灵动岛。
2. 系统级截图/录屏保护：使用官方或框架提供能力尽量保护。
3. 第三方会议软件/录屏软件：不承诺绝对不可见，只做测试矩阵。

这不是产品保守，而是系统事实。Apple 官方对 `NSWindow.SharingType.none` 也明确提醒不要把它当成隐藏/遗漏捕获内容的绝对手段。

官方参考：

- Apple NSWindow sharing type none: https://developer.apple.com/documentation/appkit/nswindow/sharingtype-swift.enum/none
- Tauri window config/content protection: https://v2.tauri.app/reference/config/
- Apple ScreenCaptureKit: https://developer.apple.com/documentation/screencapturekit/

## 2. macOS 方案

### 2.1 基础窗口形态

使用：

- Tauri transparent frameless window。
- `contentProtected: true`。
- AppKit `NSPanel`。
- `nonactivatingPanel`。
- floating level。
- `canJoinAllSpaces`。
- `fullScreenAuxiliary`。

目标：

- 常驻顶部。
- 不抢焦点。
- 在全屏和不同 Space 中尽量可见。
- 尽量减少被传统 window capture 捕获。

### 2.2 sharingType

通过 Tauri `contentProtected` 和 macOS 原生窗口句柄设置：

```swift
window.sharingType = .none
```

作用：

- 降低窗口内容被其他进程通过部分捕获 API 读取的概率。

限制：

- 不能保证所有 ScreenCaptureKit 或第三方录屏实现都排除。
- 在新系统和不同录屏软件里行为可能变化。

### 2.3 自己截图前隐藏

这是最可靠的链路。

```text
request screenshot
  -> set island hidden
  -> wait 120-200ms for compositor
  -> capture screen
  -> restore island
```

验收：

- 连续截图 20 次都不能出现灵动岛。
- 展开状态和收起状态都要测。
- 多显示器至少测当前显示器。

### 2.4 是否使用私有 API

P0 不使用私有 API。

原因：

- 签名、公证、系统兼容性风险高。
- 第一版目标是可交付 MVP，不是做绕过工具。
- 如果未来要研究更强隐藏，只能作为实验分支，不能作为稳定产品承诺。

## 3. 非目标平台

Windows/Linux 不在当前产品范围内，不做隐藏方案、测试矩阵或诊断项。

## 5. 诊断功能

设置页必须提供“隐藏测试”。

测试项：

- 当前窗口是否启用 `contentProtected`。
- macOS 是否成功设置 NSPanel。
- 本应用截图测试结果。
- 用户手动录屏测试清单。

本应用截图测试：

1. 展示灵动岛。
2. 触发内部截图。
3. 自动检查截图中是否存在灵动岛区域的明显像素。
4. 展示截图缩略图给用户确认。

## 6. 测试矩阵

### 6.1 macOS

必须测：

- macOS 当前开发机版本：15.6.1（Sequoia）。
- 系统截图快捷键。
- QuickTime 录屏。
- Zoom screen share。
- 腾讯会议共享屏幕。
- 飞书会议共享屏幕。
- OBS Display Capture。

记录结果：

| 工具 | 灵动岛是否可见 | 窗口内容是否黑块 | 备注 |
|---|---|---|---|
| 内部截图 | 否 | 否 | 必须通过 |
| 系统截图 | 待测 | 待测 | |
| QuickTime | 待测 | 待测 | |
| Zoom | 待测 | 待测 | |
| 腾讯会议 | 待测 | 待测 | |
| 飞书会议录制 | 否 | 待测 | 2026-07-04 实测通过，`set_stealth`(contentProtected) 生效 |
| 微信截图 | 否 | 待测 | 2026-07-04 实测通过，`set_stealth`(contentProtected) 生效 |
| OBS | 待测 | 待测 | |

## 7. 产品文案边界

不能写：

- “完全不会被录屏录到。”
- “100% 隐身。”
- “任何会议软件都看不到。”

可以写：

- “隐藏模式会尽量避免悬浮窗出现在常见截图和录屏中。”
- “本应用截图分析时会自动隐藏悬浮窗。”
- “不同系统版本和录屏软件行为不同，建议在设置页运行隐藏测试。”

## 8. 开发验收

P0 必须完成：

- Tauri `contentProtected`。
- macOS NSPanel。
- 内部截图前隐藏。
- 诊断页展示保护状态。
- 产品文案不做绝对承诺。

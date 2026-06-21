# Floating Island Design

## 1. 结论

第一版悬浮气泡不是普通网页浮层，而是一个原生桌面悬浮窗口承载 React UI。

技术方案：

```text
Tauri WebviewWindow
  -> transparent + frameless + always-on-top
  -> macOS NSPanel enhancement
  -> Windows display affinity enhancement
  -> React Pluely-style island UI
```

实现原则：

- 原生窗口负责系统级行为。
- React 负责视觉和交互。
- Rust 负责窗口控制、隐藏、截图前恢复、跨平台差异。
- 第一版交互和样式对标 Pluely。

## 2. 目标形态

默认形态：

```text
screen top center
  600px width
  54px height
  transparent host window
  one compact card toolbar
```

展开形态：

```text
screen top center
  600px width
  600px height
  toolbar remains at top
  panel/popover expands below toolbar
```

视觉结构：

```text
┌────────────────────────────────────────────────────────┐
│ [audio] [ask / transcript / audio visualizer....] [shot] [status] [drag] │
└────────────────────────────────────────────────────────┘
```

## 3. 为什么不是纯 Web 浮层

纯 Web 浮层只能存在于应用窗口内部，不能跨 Zoom、飞书会议、浏览器、IDE、PPT 等其他应用悬浮。

我们需要的是桌面级能力：

- 永远在其他应用上方。
- 不出现在任务栏/Dock。
- 不抢焦点。
- 可跨 Space/全屏窗口显示。
- 可设置内容保护。
- 可截图前隐藏。
- 可注册全局快捷键。

这些必须由 Tauri/Rust/系统 API 实现。

## 4. Tauri 窗口配置

第一版主窗口配置：

```json
{
  "label": "island",
  "url": "/",
  "width": 600,
  "height": 54,
  "minWidth": 600,
  "minHeight": 54,
  "decorations": false,
  "transparent": true,
  "alwaysOnTop": true,
  "visibleOnAllWorkspaces": true,
  "skipTaskbar": true,
  "contentProtected": true,
  "focus": false,
  "shadow": false,
  "resizable": false
}
```

说明：

- `transparent`: 让窗口背景透明，只显示 React card。
- `decorations: false`: 去掉系统标题栏。
- `alwaysOnTop`: 悬浮在会议软件上方。
- `visibleOnAllWorkspaces`: macOS 多 Space 尽量可见。
- `skipTaskbar`: 不出现在任务栏/Dock。
- `contentProtected`: 基础录屏保护。
- `focus: false`: 默认不抢焦点。
- `resizable: false`: 尺寸由 Rust command 控制。

## 5. macOS 原生增强

### 5.1 NSPanel

macOS 上启动后将 Tauri window 转换/增强为 NSPanel。

目标：

- 非激活面板。
- 浮动层级。
- 全屏辅助显示。
- 跨 Space。
- 尽量不打断当前应用焦点。

关键属性：

```text
NSPanel
  styleMask includes nonactivatingPanel
  level = floating / status
  collectionBehavior includes canJoinAllSpaces
  collectionBehavior includes fullScreenAuxiliary
  hidesOnDeactivate = false
  becomesKeyOnlyIfNeeded = true
```

### 5.2 内容保护

设置：

```text
NSWindow.sharingType = .none
```

边界：

- 这是 best-effort，不保证所有录屏软件不可见。
- 自己的截图链路必须通过隐藏窗口确保不被截入。

### 5.3 焦点策略

默认行为：

- 灵动岛不抢当前会议/IDE/浏览器焦点。
- 点击 input 时才允许获得输入焦点。
- 拖拽手柄只拖动窗口，不触发业务操作。

实现策略：

- 主窗口默认 `focus: false`。
- macOS panel 使用 non-activating style。
- 输入框需要时显式 focus。

## 6. Windows 原生增强

### 6.1 窗口保护

Windows 使用：

```text
SetWindowDisplayAffinity(hwnd, WDA_EXCLUDEFROMCAPTURE)
```

作用：

- 在 Windows 10 2004+ 上尽量从屏幕捕获中排除该窗口。

边界：

- 老系统退化。
- 部分捕获链路仍可能可见。
- 诊断页必须显示设置是否成功。

### 6.2 窗口层级

使用 Tauri always-on-top，必要时补 Win32 topmost。

目标：

- 在会议软件和浏览器上方。
- 不进入任务栏。
- 不抢主窗口焦点。

## 7. 前端 UI 结构

React 组件：

```text
IslandShell
  -> IslandToolbar
      -> AudioToggleButton
      -> TranscriptTicker / AskInput / AudioVisualizer
      -> ScreenshotButton
      -> StatusIndicator
      -> DragHandleButton
  -> IslandPopoverPanel
```

### 7.1 IslandShell

职责：

- 提供透明窗口里的布局根节点。
- 保证内容贴顶部居中。
- 根据 hidden 状态隐藏整岛。

结构：

```tsx
<div className="w-screen h-screen flex overflow-hidden justify-center items-start">
  <IslandToolbar />
  <IslandPopoverPanel />
</div>
```

### 7.2 IslandToolbar

职责：

- Pluely-style 横向 Card。
- 所有主操作在一行内。
- 收起态高度固定。

样式：

```text
width: 100%
height: 54px
padding: 8px
gap: 8px
border-radius: 12px
background: card/80
border: secondary/30
backdrop blur
```

### 7.3 中间区域

中间区域按状态切换：

```text
idle -> AskInput
listening -> AudioVisualizer + short transcript
transcribing -> spinner + Transcribing...
thinking -> spinner + Generating...
answer -> short answer ticker / open panel
```

约束：

- `min-width: 0`。
- 单行截断。
- 不因文本变化改变窗口高度。
- 不出现跑马灯。

### 7.4 DragHandleButton

要求：

```tsx
<button data-tauri-drag-region="true">
  <GripVertical />
</button>
```

注意：

- drag region 只放在手柄，不覆盖 input/buttons。
- 否则会导致按钮点击或输入焦点异常。

## 8. 展开/收起实现

### 8.1 Rust command

```rust
#[tauri::command]
pub fn set_island_height(window: tauri::WebviewWindow, height: u32) -> Result<(), String> {
    let size = tauri::LogicalSize::new(600.0, height as f64);
    window.set_size(size).map_err(|e| e.to_string())?;
    Ok(())
}
```

### 8.2 前端 hook

```ts
export function useIslandResize() {
  const resizeIsland = async (expanded: boolean) => {
    await invoke("set_island_height", {
      height: expanded ? 600 : 54,
    });
  };

  return { resizeIsland };
}
```

### 8.3 Popover 策略

规则：

- 打开 Ask/Audio/Diagnostics popover 时展开到 `600`。
- 关闭所有 popover 后收起到 `54`。
- 如果正在截图，等截图恢复后再收起。
- 如果正在生成，允许面板关闭，但后台任务继续。

避免问题：

- 多个 popover 同时打开。
- 关闭一个 popover 导致另一个还开着但窗口先收起。
- 拖拽结束后误收起。

实现建议：

- 前端维护 `openPanel: null | "audio" | "assistant" | "diagnostics"`。
- 只有 `openPanel === null` 时收起。

## 9. 位置策略

P0：

- 默认顶部居中。
- 可通过拖拽手柄移动。
- 重启后恢复上次位置。

P1：

- 提供位置 preset:
  - top-center
  - top-left
  - top-right
  - bottom-center

位置存储：

```json
{
  "island_position": {
    "display_id": "main",
    "x": 660,
    "y": 54
  }
}
```

macOS 顶部偏移：

- 默认 `54px`，避开菜单栏区域。
- 多显示器时按当前显示器可见区域计算。

## 10. 隐藏策略

### 10.1 用户手动隐藏

快捷键：

```text
Cmd/Ctrl + Shift + Space
```

行为：

- 已显示 -> hide window。
- 已隐藏 -> show window。
- 状态保留。

### 10.2 截图前隐藏

流程：

```text
capture_request
  -> remember visible state
  -> hide island
  -> wait 120-200ms
  -> capture screen
  -> restore island if previously visible
```

必须用 guard 模式，避免截图失败后窗口不恢复。

### 10.3 录屏保护

组合：

- Tauri `contentProtected`。
- macOS `NSWindow.sharingType = .none`。
- Windows `WDA_EXCLUDEFROMCAPTURE`。
- 内部截图前主动 hide。

## 11. 状态机

```text
Hidden
VisibleCollapsed
VisibleExpanded
TemporarilyHiddenForCapture
Error
```

转移：

```text
VisibleCollapsed -> VisibleExpanded: open panel
VisibleExpanded -> VisibleCollapsed: close panel
VisibleCollapsed -> Hidden: global hide
VisibleExpanded -> Hidden: global hide
VisibleCollapsed -> TemporarilyHiddenForCapture: screenshot
VisibleExpanded -> TemporarilyHiddenForCapture: screenshot
TemporarilyHiddenForCapture -> previous visible state: restore
```

规则：

- 临时隐藏不能覆盖用户手动隐藏状态。
- 截图前如果用户本来就是隐藏，不需要恢复显示。
- 展开/收起不能改变监听状态。

## 12. 与 Pluely 的对应关系

| 能力 | Pluely 实现 | 我们 P0 |
|---|---|---|
| 默认尺寸 | `600 x 54` | 采用 |
| 展开高度 | `600` | 采用 |
| 窗口壳 | Tauri transparent frameless | 采用 |
| 主 UI | 横向 Card | 采用 |
| 拖拽 | GripVertical + drag region | 采用 |
| 音频入口 | SystemAudio button | 采用并改中文场景 |
| 状态 | StatusIndicator | 采用 |
| 截图 | Screenshot button | 采用并加截图前隐藏 |
| 隐藏 | contentProtected | 采用并补 NSWindow/Win32 |

## 13. 验收标准

### 13.1 外观

- 默认顶部居中。
- 尺寸 `600 x 54`。
- 背景透明，只显示 Card。
- Card 横向布局。
- 圆角约 `12px`。
- 轻边框、轻阴影、轻毛玻璃。
- icon button 尺寸约 `36 x 36`。

### 13.2 行为

- 可拖拽。
- 不抢焦点。
- 可全局快捷键隐藏/显示。
- popover 打开后高度到 `600`。
- popover 全部关闭后高度回到 `54`。
- 监听中状态持续可见。
- 截图前隐藏，截图后恢复。

### 13.3 平台

macOS：

- NSPanel 生效。
- 全屏辅助可见。
- 跨 Space 尽量可见。
- content protection 生效。

Windows：

- always-on-top 生效。
- taskbar 不显示。
- display affinity 设置成功时诊断可见。

### 13.4 回归测试

- 连续展开/收起 50 次不发生尺寸错乱。
- 拖拽后位置可保存。
- 输入框可正常 focus。
- 按钮点击不被 drag region 吃掉。
- 截图失败也能恢复窗口。
- 文本超长不撑破工具条。


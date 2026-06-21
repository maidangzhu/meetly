# Pluely Style Spec

## 1. 结论

第一版交互和样式明确对标 Pluely。

这里的“对标”不是复制品牌、文案或业务细节，而是复制它适合会议辅助软件的核心交互形态：

- 顶部居中。
- `600 x 54` 紧凑灵动岛。
- 透明无边框原生窗口。
- 一张横向 `Card` 容器承载全部主操作。
- 图标按钮为主。
- 展开面板从灵动岛下方出现。
- 收起态尽量不打断用户当前会议窗口。

## 2. Pluely 关键观察

从 `pluely-master` 代码看，主窗口配置是：

```json
{
  "width": 600,
  "height": 54,
  "decorations": false,
  "transparent": true,
  "visibleOnAllWorkspaces": true,
  "skipTaskbar": true,
  "contentProtected": true,
  "focus": false,
  "shadow": false
}
```

主 UI 是：

```text
full screen transparent host
  -> top centered card
      -> system audio button
      -> completion/input area or audio visualizer
      -> status indicator
      -> updater
      -> drag button
```

窗口展开逻辑：

```text
collapsed height: 54
expanded height: 600
```

通过 `set_window_height` 控制窗口高度，popover 关闭后回到 `54`。

## 3. 我们第一版主界面

### 3.1 收起态

尺寸：

- Window: `600 x 54`
- 主容器: `width: 100%`
- Padding: `8px`
- Gap: `8px`
- Icon button: `36 x 36`
- Icon: `16 x 16`
- Border radius: `12px`

布局：

```text
┌────────────────────────────────────────────────────────┐
│ [audio] [transcript ticker / ask input..........] [shot] [status] [drag] │
└────────────────────────────────────────────────────────┘
```

状态变化：

- idle: audio button 使用默认色，ticker 显示占位。
- listening: audio button 绿色轻底，状态点脉冲，中央显示音频条或最新转写。
- transcribing: spinner + `Transcribing...`。
- thinking: spinner + `Generating...`。
- error: 红色轻底，点击后打开诊断 popover。

### 3.2 展开态

尺寸：

- Window width: `600`
- Window height: `420-600`
- P0 推荐直接 `600`
- Popover side: bottom
- Popover offset: `8px`
- Panel width: `100vw`，等于 Tauri window 宽度。

布局：

```text
toolbar, height 54
panel header, height 44-52
scroll content
bottom input/actions if needed
```

面板内容：

- 顶部 header：模式切换、截图、新会话、关闭。
- 主区：最近转写 + AI 建议。
- 底部：可选 Ask 输入或快捷动作。

约束：

- 展开态不是 dashboard。
- 不做侧边栏。
- 不做多列复杂布局。
- 不做大标题。
- 不做欢迎页。

## 4. 视觉 Token

第一版沿 Pluely 的中性 token 方向：

```css
--radius: 10px;
--island-width: 600px;
--island-collapsed-height: 54px;
--island-expanded-height: 600px;
--island-padding: 8px;
--control-size: 36px;
--icon-size: 16px;
```

容器：

```css
.island-card {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 8px;
  border-radius: 12px;
  border: 1px solid color-mix(in oklch, var(--secondary) 30%, transparent);
  background: color-mix(in oklch, var(--card) 80%, transparent);
  box-shadow: 0 1px 3px rgb(0 0 0 / 0.1);
  backdrop-filter: blur(20px);
}
```

按钮：

```css
.icon-button {
  width: 36px;
  height: 36px;
  border-radius: 12px;
}
```

字体：

- 工具条正文：`12-14px`。
- 状态文字：`12px`。
- 面板标题：`12-14px`。
- 不使用 hero 字号。

颜色：

- 以中性黑白灰为主。
- 成功状态只用小面积绿色。
- 错误状态只用小面积红色。
- 警告状态只用小面积橙色。
- 不使用大面积紫蓝渐变。

## 5. 组件清单

### 5.1 `IslandShell`

职责：

- 承载顶层透明窗口内的主 Card。
- 控制隐藏 class。
- 保持 `w-screen h-screen flex justify-center items-start overflow-hidden`。

### 5.2 `IslandToolbar`

职责：

- 横排主操作。
- 不直接处理业务，只调用 hooks。

子组件：

- `AudioToggleButton`
- `TranscriptTicker`
- `AskInput`
- `ScreenshotButton`
- `StatusIndicator`
- `DragHandleButton`

### 5.3 `AudioToggleButton`

对标 Pluely `SystemAudio` button。

状态：

- setupRequired: 橙色 alert icon。
- error: 红色 alert icon。
- processing: spinner。
- listening: 绿色 audio icon + pulse。
- idle: headphones icon。

### 5.4 `TranscriptTicker`

职责：

- 收起态显示最新 final/partial transcript。
- 长文本单行省略。
- 不撑开布局。

规则：

- 最大宽度由 flex 剩余空间决定。
- `min-width: 0`。
- `overflow: hidden`。
- `text-overflow: ellipsis`。
- 不滚动跑马灯，避免干扰会议。

### 5.5 `AskInput`

对标 Pluely `Completion/Input`。

收起态：

- 一个紧凑 input。
- placeholder: `Ask...`
- Enter 触发 Ask。
- 生成中右侧 spinner。

展开态：

- AI Response panel。
- header + copy + close。
- 内容使用 scroll area。

### 5.6 `ScreenshotButton`

对标 Pluely `Screenshot`。

状态：

- 默认：screen icon。
- loading：spinner。
- provider 不支持 vision：disabled + tooltip。

点击后：

- Rust 隐藏灵动岛。
- 截图。
- 恢复。
- 打开展开面板展示结果。

### 5.7 `StatusIndicator`

对标 Pluely `StatusIndicator`。

优先级：

```text
error > generating > transcribing > listening > idle
```

只展示最重要的一条状态，避免工具条拥挤。

### 5.8 `DragHandleButton`

对标 Pluely `DragButton`。

要求：

- 使用 `GripVertical` icon。
- `data-tauri-drag-region=true`。
- 放在最右侧。
- 点击不触发业务。

## 6. 交互规则

### 6.1 展开/收起

- 用户打开 popover 后，窗口高度改为 `600`。
- 用户关闭 popover 后，窗口高度回到 `54`。
- 如果正在监听，不因为点击外部误关掉监听。
- 如果正在截图/生成，允许关闭面板，但后台任务继续。

### 6.2 Popover

所有临时面板都从灵动岛下方展开：

- Audio setup/error panel。
- AI response panel。
- Screenshot result panel。
- Settings quick panel 可选。

P0 不做独立大 dashboard 作为主体验。设置页可以是独立窗口。

### 6.3 快捷键

快捷键触发后要反映到同一套 Pluely-style UI：

- Ask: 聚焦/打开 AI response panel。
- Screenshot: 截图后打开 AI response panel。
- Start/stop listening: 更新 audio button 和 status。
- Show/hide: 直接隐藏或显示整个 island。

### 6.4 动效

只做必要动效：

- spinner。
- listening pulse。
- popover fade/zoom。
- 音频条轻微变化。

不做：

- 大面积流光。
- 弹跳动画。
- 背景装饰球。
- Hero 式过场。

## 7. 与 Pluely 的差异

我们不是逐像素复制。

必须不同：

- 文案围绕中文会议/面试。
- STT 是国内实时 Provider。
- 隐藏诊断是第一版核心项。
- 设置页更强调 BYOK 和隐私。
- 不加入 license/paywall 交互。

可以一致：

- 窗口尺寸。
- 横向工具条布局。
- 图标按钮尺寸。
- popover 展开方式。
- 紧凑中性视觉。
- 音频状态和 spinner 行为。

## 8. 验收标准

第一版 UI 过验收必须满足：

- 启动后默认窗口是 `600 x 54`。
- 顶部居中。
- 主 UI 是一张横向 Card。
- 左侧有音频入口。
- 中间有 Ask/转写区域。
- 右侧有截图、状态、拖拽手柄。
- 图标按钮约 `36 x 36`。
- icon 约 `16 x 16`。
- 展开后高度变为 `600`。
- popover 从下方展开，宽度跟随窗口。
- 收起后不会留下空白透明大窗口。
- 文本不会撑破工具条。
- 深浅色背景下都可读。
- 视觉上能被一眼识别为 Pluely-style meeting assistant。

